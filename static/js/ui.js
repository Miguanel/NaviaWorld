/* Drobne narzędzia interfejsu */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const g = (glyph, cls = '') => h('i', { class: 'glyph ' + cls }, glyph || '•');

function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 3200);
  setTimeout(() => t.remove(), 3700);
}

function toastAll(list, kind = '') { (list || []).forEach((m, i) => setTimeout(() => toast(m, kind), i * 250)); }

const Sheet = {
  current: null,
  open(id, title, renderFn) {
    this.current = id;
    this.render = renderFn;
    $('#sheet-title').textContent = title;
    const body = $('#sheet-body');
    body.innerHTML = '';
    renderFn(body);
    $('#sheet').classList.add('open');
    $('#scrim').classList.add('on');
    $$('#dock button').forEach(b => b.classList.toggle('on', b.dataset.open === id));
  },
  refresh() {
    if (!this.current || !this.render) return;
    const body = $('#sheet-body');
    const top = body.scrollTop;
    body.innerHTML = '';
    this.render(body);
    body.scrollTop = top;
  },
  close() {
    this.current = null;
    $('#sheet').classList.remove('open');
    $('#scrim').classList.remove('on');
    $$('#dock button').forEach(b => b.classList.remove('on'));
    Bag.closeBubble();
  },
};

const Modal = {
  open(content, { onClose, dismissable = true } = {}) {
    this.close();
    const card = h('div', { class: 'scroll-card' }, content);
    const m = h('div', { class: 'modal' }, card);
    if (dismissable) m.addEventListener('click', e => { if (e.target === m) this.close(); });
    this.onClose = onClose;
    $('#modal-root').appendChild(m);
    return card;
  },
  close() {
    const r = $('#modal-root');
    if (r.firstChild) { r.innerHTML = ''; if (this.onClose) { const f = this.onClose; this.onClose = null; f(); } }
  },
  get isOpen() { return !!$('#modal-root').firstChild; },
};

function bar(el, val, max) {
  el.style.width = Math.max(0, Math.min(100, 100 * val / Math.max(1, max))) + '%';
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec >= 3600) return Math.floor(sec / 3600) + ' h ' + Math.floor((sec % 3600) / 60) + ' min';
  if (sec >= 60) return Math.floor(sec / 60) + ' min';
  return sec + ' s';
}

function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

const CAT_NAMES = {
  ziolo: 'Zioła', grzyb: 'Grzyby', mineral: 'Minerały', drewno: 'Drewno', woda: 'Woda', czesc_potwora: 'Trofea',
  narzedzie: 'Narzędzia', konstrukcja: 'Konstrukcje', eliksir: 'Eliksiry', olej: 'Oleje', wywar: 'Przemiany',
  katalizator: 'Katalizatory', bron: 'Broń', pancerz: 'Pancerze', jedzenie: 'Jadło', artefakt: 'Artefakty', inne: 'Inne',
};

/* Waluta: 1 dobrota = 100 groszy */
function plural(n, one, few, many) {
  n = Math.abs(Math.trunc(n));
  if (n === 1) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few;
  return many;
}
function money(g, short = false) {
  g = Math.round(g || 0);
  const sign = g < 0 ? '−' : '';
  const a = Math.abs(g), d = Math.floor(a / 100), r = a % 100;
  const parts = [];
  if (d) parts.push(short ? `${d} db` : `${d} ${plural(d, 'dobrota', 'dobroty', 'dobrot')}`);
  if (r || !d) parts.push(`${r} gr`);
  return sign + parts.join(' ');
}

/* Kierunek świata z punktu A do B */
function bearingDeg(lat1, lng1, lat2, lng2) {
  const toR = x => x * Math.PI / 180;
  const y = Math.sin(toR(lng2 - lng1)) * Math.cos(toR(lat2));
  const x = Math.cos(toR(lat1)) * Math.sin(toR(lat2)) - Math.sin(toR(lat1)) * Math.cos(toR(lat2)) * Math.cos(toR(lng2 - lng1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function directionName(deg) {
  return ['północ', 'północny wschód', 'wschód', 'południowy wschód', 'południe', 'południowy zachód', 'zachód', 'północny zachód'][Math.round(deg / 45) % 8];
}
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m'; }
