const form = document.querySelector('#request');
const statusLine = document.querySelector('#status');
const dateFormat = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit'});
const today = dateFormat.format(new Date());
const initialMonth = new Date(today.slice(0, 7) + '-01T12:00:00Z');
let view = new Date(initialMonth);
let selected = '';
const monthLabel = document.querySelector('#month');
const grid = document.querySelector('#days');
const prev = document.querySelector('#prev');

function calendar() {
  grid.replaceChildren();
  for (const day of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']) {
    const label = document.createElement('span');
    label.textContent = day;
    grid.append(label);
  }
  monthLabel.textContent = view.toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'});
  prev.disabled = +view <= +initialMonth;
  for (let i = 0; i < view.getUTCDay(); i++) grid.append(document.createElement('span'));
  const date = new Date(view);
  while (date.getUTCMonth() === view.getUTCMonth()) {
    const iso = date.toISOString().slice(0, 10);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = date.getUTCDate();
    button.setAttribute('aria-label', date.toLocaleDateString('en-US', {dateStyle:'full', timeZone:'UTC'}));
    button.setAttribute('aria-pressed', String(selected === iso));
    button.disabled = iso < today;
    button.addEventListener('click', () => {
      grid.querySelector('[aria-pressed=true]')?.setAttribute('aria-pressed','false');
      selected = iso;
      button.setAttribute('aria-pressed','true');
      document.querySelector('#chosen').textContent = button.getAttribute('aria-label');
    });
    grid.append(button);
    date.setUTCDate(date.getUTCDate() + 1);
  }
}
prev.addEventListener('click', () => { view.setUTCMonth(view.getUTCMonth() - 1); calendar(); });
document.querySelector('#next').addEventListener('click', () => { view.setUTCMonth(view.getUTCMonth() + 1); calendar(); });
calendar();

for (const link of document.querySelectorAll('[data-program]')) {
  link.addEventListener('click', () => { form.elements.program.value = link.dataset.program; });
}
fetch('/api/config').then(r => r.json()).then(config => {
  if (config.paymentUrl) {
    const link = document.querySelector('#pay-link');
    link.href = config.paymentUrl;
    link.hidden = false;
  }
}).catch(() => {});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!selected) {
    statusLine.textContent = 'Choose a preferred date first.';
    grid.querySelector('button:not(:disabled)')?.focus();
    return;
  }
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  statusLine.textContent = 'Sending your request…';
  try {
    const fields = Object.fromEntries(new FormData(form));
    const response = await fetch('/api/bookings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...fields, date:selected})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    form.reset();
    selected = '';
    calendar();
    document.querySelector('#chosen').textContent = 'Select a preferred date.';
    statusLine.textContent = data.sms
      ? 'Request received. A text is on its way. Coach Lim will confirm your session.'
      : 'Request received. Coach Lim will follow up to confirm your session.';
  } catch (error) {
    statusLine.textContent = error.message === 'Failed to fetch' ? 'Connection dropped. Please try again.' : error.message;
  } finally {
    submit.disabled = false;
  }
});
