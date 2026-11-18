import { assets } from './assets.mjs';

const zone = 'America/New_York';
const dateFormat = new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'});
const programs = ['Youth training', 'Professional training', 'Professional travel inquiry'];
const origin = 'https://epps-speed-agility.nuttysugar21.chatgpt.site';
const json = (body, status=200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const fail = (error, status=400) => json({error},status);
const dayKey = date => 'schedule/' + date;
const today = () => dateFormat.format(new Date());

async function readDay(bucket, date) {
  const entry = await bucket.get(dayKey(date));
  return {rows:entry ? await entry.json() : [], etag:entry?.httpEtag};
}
async function writeDay(bucket,date,day) {
  const condition = day.etag ? {'If-Match':day.etag} : {'If-None-Match':'*'};
  return bucket.put(dayKey(date), JSON.stringify(day.rows), {onlyIf:new Headers(condition)});
}
function workingMinute(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '') ? Number(value.slice(0,2))*60 + Number(value.slice(3)) : fallback;
}
function clock(minutes) {
  return new Date(Date.UTC(2000,0,1,0,minutes)).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
}
function locationKey(location) {
  return location.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function travelBetween(a,b,env) {
  const from = locationKey(a);
  const to = locationKey(b);
  if (from === to) return 0;
  let overrides = {};
  try { overrides = JSON.parse(env.TRAVEL_MINUTES_BY_ROUTE || '{}'); } catch {}
  const configured = overrides[from + '|' + to] ?? overrides[to + '|' + from] ?? Number(env.DEFAULT_TRAVEL_MINUTES ?? 60);
  return Number.isInteger(configured) && configured >= 0 && configured <= 1440 ? configured : 60;
}
function candidates(request,rows,env) {
  const opening = workingMinute(env.COACH_START_ET, 9*60);
  const closing = workingMinute(env.COACH_END_ET, 18*60);
  const booked = rows.filter(row => row.start != null).sort((a,b) => a.start-b.start);
  const now = new Date();
  const easternClock = now.toLocaleTimeString('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
  const minimum = request.date === today() ? Math.max(opening,workingMinute(easternClock,opening)+15) : opening;
  const slots = [];
  if (request.date < today()) return slots;
  for (let start = Math.ceil(minimum/15)*15; start+request.duration<=closing; start+=15) {
    const end = start+request.duration;
    if (booked.some(row => start < row.start+row.duration && end > row.start)) continue;
    const before = booked.filter(row => row.start+row.duration<=start).at(-1);
    const after = booked.find(row => row.start>=end);
    const incoming = before ? travelBetween(before.location,request.location,env) : 0;
    const outgoing = after ? travelBetween(request.location,after.location,env) : 0;
    const left = before ? start-(before.start+before.duration)-incoming : Infinity;
    const right = after ? after.start-end-outgoing : Infinity;
    if (left<0 || right<0) continue;
    slots.push({start,travel:incoming+outgoing,gap:booked.length ? Math.min(left,right) : 0});
  }
  return slots.sort((a,b) => a.travel-b.travel || a.gap-b.gap || a.start-b.start);
}
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date+'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === date && date>=today() && +parsed<=Date.now()+366*86400000;
}
async function sms(env, to, message) {
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID)) return false;
  try {
    const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(env.TWILIO_ACCOUNT_SID)+'/Messages.json', {
      method:'POST',
      headers:{Authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN)},
      body:new URLSearchParams({To:to,MessagingServiceSid:env.TWILIO_MESSAGING_SERVICE_SID,Body:message})
    });
    return response.ok;
  } catch {return false;}
}
async function checkout(env, request, start, cents) {
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions',{
    method:'POST',
    headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Idempotency-Key':request.id+'-'+start+'-'+cents},
    body:new URLSearchParams({
      mode:'payment',
      success_url:origin+'/#booking',cancel_url:origin+'/#booking',
      client_reference_id:request.id,
      customer_email:request.email,
      'line_items[0][quantity]':'1',
      'line_items[0][price_data][currency]':'usd',
      'line_items[0][price_data][unit_amount]':String(cents),
      'line_items[0][price_data][product_data][name]':'Epps Speed & Agility · '+request.program
    })
  });
  if (!response.ok) throw new Error('Checkout could not be created. Check Stripe configuration and try again.');
  return (await response.json()).url;
}
async function explain(env,request,slots) {
  if (!env.OPENAI_API_KEY || !slots.length) return '';
  try {
    const response = await fetch('https://api.openai.com/v1/responses',{
      method:'POST', signal:AbortSignal.timeout(7000),
      headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:env.OPENAI_MODEL || 'gpt-4.1-mini',store:false,max_output_tokens:160,
        instructions:'You are Coach Lim’s scheduling assistant. In one short sentence explain the tradeoff in the supplied, already ranked appointment options. Times are Eastern. Do not invent times, locations, or facts. The schedule is pending Coach Lim’s approval.',
        input:JSON.stringify({sessionMinutes:request.duration,options:slots.map(slot => ({time:clock(slot.start),travelMinutes:slot.travel,gapMinutes:slot.gap}))})
      })
    });
    if (!response.ok) return '';
    const result = await response.json();
    return result.output?.flatMap(item=>item.content ?? []).find(item=>item.type==='output_text')?.text ?? '';
  } catch {return '';}
}
async function requestBooking(request,env) {
  const fields = await request.json();
  const clean = (name,max) => typeof fields[name]==='string' ? fields[name].trim().slice(0,max) : '';
  const name=clean('name',100), email=clean('email',180), location=clean('location',120);
  const date=clean('date',10), program=clean('program',40), duration=Number(fields.duration);
  const digits=clean('phone',25).replace(/\D/g,'');
  const phone=digits.length===10 ? '+1'+digits : '+'+digits;
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+1[2-9]\d{9}$/.test(phone) ||
    !locationKey(location) || !validDate(date) || !programs.includes(program) || ![30,60,90].includes(duration)) return fail('Check your contact information, location and preferred date. Use a US or Canadian mobile number and select a date within the next year.');
  const row={id:date+'_'+crypto.randomUUID(),name,email,phone,date,program,duration,location,consent:fields.consent==='on',createdAt:new Date().toISOString()};
  for (let attempt=0; attempt<4; attempt++) {
    const day=await readDay(env.BUCKET,date);
    if (day.rows.some(item=>item.email.toLowerCase()===email.toLowerCase() && item.phone===phone && item.program===program)) return json({sms:false},200);
    if (day.rows.length>=150) return fail('Please choose another preferred date or contact Coach Lim on Instagram.',429);
    day.rows.push(row);
    if (await writeDay(env.BUCKET,date,day)) {
      const sent = row.consent && await sms(env,phone,'Epps Speed & Agility received your request for '+date+'. Coach Lim will follow up with session details. Reply STOP to opt out.');
      return json({sms:sent},201);
    }
  }
  return fail('The schedule is busy. Please try again.',409);
}
async function coach(request,url,env) {
  if (!env.COACH_ACCESS_KEY) return fail('Coach access has not been configured.',503);
  if (request.headers.get('Authorization') !== 'Bearer '+env.COACH_ACCESS_KEY) return fail('Coach access key is incorrect.',401);
  if (request.method==='GET' && url.pathname==='/api/coach/requests') {
    const rows=[];
    let cursor;
    do {
      const page=await env.BUCKET.list({prefix:'schedule/',cursor});
      const days=await Promise.all(page.objects.map(async item => (await env.BUCKET.get(item.key))?.json()));
      for (const day of days) if (day) rows.push(...day);
      cursor=page.truncated ? page.cursor : undefined;
    } while (cursor);
    return json(rows.sort((a,b)=>a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)));
  }
  if (request.method!=='POST') return fail('Method not allowed.',405);
  const {id,start,cents}=await request.json();
  if (typeof id!=='string' || !/^\d{4}-\d{2}-\d{2}_[\da-f-]{36}$/.test(id)) return fail('Select a session request.');
  const date=id.slice(0,10);
  const day=await readDay(env.BUCKET,date);
  const row=day.rows.find(item=>item.id===id);
  if (!row || row.start!=null) return fail('This request has already been confirmed or is unavailable.',409);
  const options=candidates(row,day.rows,env);
  if (url.pathname==='/api/coach/suggest') {
    const slots=options.slice(0,4);
    return json({slots,summary:await explain(env,row,slots)});
  }
  if (url.pathname!=='/api/coach/confirm') return fail('Not found.',404);
  if (!options.some(slot=>slot.start===start)) return fail('That opening changed. Find times again.',409);
  if (!Number.isInteger(cents)||cents<0||cents>9999900|| (cents>0&&cents<50)) return fail('Enter an agreed price of at least $0.50 or leave the price blank.');
  if (cents && !env.STRIPE_SECRET_KEY) return fail('Stripe checkout has not been configured.',503);
  if (cents) {
    try { row.checkout=await checkout(env,row,start,cents); }
    catch(error) {return fail(error.message,502);}
  }
  row.start=start;
  if (!await writeDay(env.BUCKET,date,day)) return fail('The schedule changed. Refresh requests and find times again.',409);
  const sent=row.consent && await sms(env,row.phone,'Epps Speed & Agility: Your session is confirmed for '+date+' at '+clock(start)+' ET. Location: '+row.location+'.'+(row.checkout?' Pay securely: '+row.checkout:''));
  return json({sms:sent});
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        if (request.method==='POST' && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin) return fail('Invalid origin.',403);
        if (request.method==='GET' && url.pathname==='/api/config') {
          const paymentUrl=/^https:\/\/buy\.stripe\.com\/[\w/]+$/.test(env.STRIPE_PAYMENT_URL ?? '') ? env.STRIPE_PAYMENT_URL : null;
          return json({paymentUrl});
        }
        if (!env.BUCKET) return fail('Online booking is unavailable. Contact Coach Lim on Instagram.',503);
        if (request.method==='POST' && url.pathname==='/api/bookings') return await requestBooking(request,env);
        if (url.pathname.startsWith('/api/coach/')) return await coach(request,url,env);
        return fail('Not found.',404);
      } catch(error) {
        if (error instanceof SyntaxError) return fail('Invalid request.');
        console.error('Booking API request failed',error.name);
        return fail('The service is temporarily unavailable. Please try again.',503);
      }
    }
    const key=url.pathname==='/' ? '/index.html' : url.pathname==='/coach-dashboard' ? '/coach.html' : url.pathname;
    const asset=Object.hasOwn(assets,key) && assets[key];
    if (!asset) return new Response('Page not found',{status:404});
    const [type,body,binary]=asset;
    return new Response(binary ? Uint8Array.from(atob(body),c=>c.charCodeAt(0)) : body,{
      headers:{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':key.startsWith('/assets/')?'public, max-age=86400':'no-cache'}
    });
  }
};
