const access = document.querySelector('#access');
const message = document.querySelector('#message');
const container = document.querySelector('#requests');
let key = '';
async function api(path, fields) {
  const headers = {Authorization:'Bearer ' + key};
  if (fields) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/coach/' + path, {
    headers, method:fields ? 'POST' : 'GET', body:fields && JSON.stringify(fields)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function localTime(minutes) {
  return new Date(Date.UTC(2000,0,1,0,minutes)).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
}
async function load() {
  const requests = await api('requests');
  container.replaceChildren();
  message.textContent = requests.length ? '' : 'No requests yet.';
  for (const request of requests) {
    const article = document.createElement('article');
    const heading = document.createElement('h3');
    heading.textContent = request.program;
    const details = document.createElement('p');
    details.textContent = [request.name,request.email,request.phone,request.date,request.location,request.duration + ' min'].join(' · ');
    article.append(heading, details);
    container.append(article);
    if (request.start != null) {
      const confirmed = document.createElement('p');
      confirmed.textContent = 'Confirmed for ' + localTime(request.start) + ' ET.';
      if (request.checkout) {
        const link = document.createElement('a');
        link.href = request.checkout;
        link.textContent = 'Copy or open client checkout link';
        confirmed.append(' ', link);
      }
      article.append(confirmed);
      continue;
    }
    const find = document.createElement('button');
    find.textContent = 'Find times';
    find.className = 'button';
    const results = document.createElement('div');
    article.append(find, results);
    find.addEventListener('click', async () => {
      find.disabled = true;
      results.textContent = 'Checking the schedule…';
      try {
        const {slots, summary} = await api('suggest', {id:request.id});
        results.textContent = summary || (slots.length ? 'Suggested start times (ET)' : 'No suitable times on this date.');
        if (slots.length === 0) return;
        const list = document.createElement('ul');
        for (const slot of slots) {
          const item = document.createElement('li');
          const confirm = document.createElement('button');
          confirm.className = 'button';
          confirm.textContent = 'Confirm ' + localTime(slot.start);
          item.append(confirm, ' · ' + slot.travel + ' min reserved for adjacent travel');
          list.append(item);
          confirm.addEventListener('click', async () => {
            const quote = window.prompt('Agreed session price in USD. Leave blank to confirm without a checkout link.', '');
            if (quote === null) return;
            if (quote && !/^\d{1,5}(\.\d{1,2})?$/.test(quote)) {
              message.textContent = 'Enter a valid USD amount.';
              return;
            }
            confirm.disabled = true;
            try {
              const saved = await api('confirm', {id:request.id,start:slot.start,cents:quote ? Math.round(Number(quote) * 100) : 0});
              await load();
              message.textContent = saved.sms ? 'Session confirmed and client text sent.' : 'Session confirmed. Contact the client with session details.';
            } catch (error) { message.textContent = error.message; }
            finally { confirm.disabled = false; }
          });
        }
        results.append(list);
      } catch (error) { results.textContent = error.message; }
      finally { find.disabled = false; }
    });
  }
}
access.addEventListener('submit',async event => {
  event.preventDefault();
  key = access.elements.key.value;
  access.reset();
  container.replaceChildren();
  try { await load(); } catch (error) { message.textContent = error.message; }
});
