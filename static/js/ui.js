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

/* Okno (większe niż modal): budowa obozu, budynki. Okna układają się w stos — „◂ Wróć” cofa do poprzedniego. */
const Win = {
  stack: [],
  get isOpen() { return this.stack.length > 0; },
  get top() { return this.stack[this.stack.length - 1]; },
  open(opts) { this.stack = []; this.push(opts); },
  push(opts) { this.stack.push(opts); this.paint(); },
  back() { this.stack.pop(); this.stack.length ? this.paint() : this.close(); },
  close() {
    this.stack = [];
    const r = $('#win-root');
    if (r) r.innerHTML = '';
    document.body.classList.remove('win-open');
  },
  /** Odświeża bieżące okno, zachowując przewinięcie. */
  async refresh() {
    if (!this.isOpen) return;
    const body = $('#win-root .win-body');
    const top = body ? body.scrollTop : 0;
    await this.paint(true);
    const nb = $('#win-root .win-body');
    if (nb) nb.scrollTop = top;
  },
  async paint(keep) {
    let root = $('#win-root');
    if (!root) { root = h('div', { id: 'win-root' }); document.body.append(root); }
    const o = this.top;
    const titleEl = h('h2', {}, o.title || '');
    const kickerEl = h('div', { class: 'event-kicker' }, o.kicker || '');
    const body = h('div', { class: 'win-body' });
    const panel = h('section', { class: 'win' + (keep ? ' still' : ''), role: 'dialog', 'aria-label': o.title || '' },
      h('header', { class: 'win-head' },
        this.stack.length > 1 ? h('button', { class: 'win-back', onclick: () => this.back(), title: 'Wróć' }, '◂') : h('span', { class: 'win-glyph' }, g(o.glyph || '❦')),
        h('div', { class: 'win-titles' }, kickerEl, titleEl),
        h('button', { class: 'x', onclick: () => this.close(), 'aria-label': 'Zamknij' }, '✕')),
      body);
    const wrap = h('div', { class: 'win-wrap' }, panel);
    wrap.addEventListener('click', e => { if (e.target === wrap) this.close(); });
    const old = root.firstChild;
    if (old && keep) old.replaceWith(wrap); else { root.innerHTML = ''; root.append(wrap); }
    document.body.classList.add('win-open');
    const api = { setTitle: t => { titleEl.textContent = t; o.title = t; }, setKicker: k => { kickerEl.textContent = k; o.kicker = k; } };
    if (!keep) body.append(h('div', { class: 'muted' }, 'Wczytuję…'));
    try {
      const frag = h('div', {});
      await o.render(frag, api);
      body.innerHTML = '';
      body.append(...frag.childNodes);
    } catch (e) {
      body.innerHTML = '';
      body.append(h('p', {}, e.message), h('button', { class: 'btn', onclick: () => this.back() }, '◂ Wróć'));
    }
  },
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (Modal.isOpen) Modal.close(); else if (Win.isOpen) Win.back();
});

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
  katalizator: 'Katalizatory', bron: 'Broń', tarcza: 'Tarcze', pancerz: 'Odzienie i pancerze', rekawice: 'Rękawice',
  bizuteria: 'Biżuteria', jedzenie: 'Jadło', artefakt: 'Artefakty', inne: 'Inne',
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

/* Dymek przyklejony do elementu (np. czipa pozycji). Zamyka się kliknięciem obok. */
const Bubble = {
  el: null,
  rect: null,
  show(anchor, content) {
    this.hide(true);
    if (anchor && anchor.isConnected) this.rect = anchor.getBoundingClientRect();
    const r = this.rect || { left: 12, bottom: 80, width: 0 };
    const el = h('div', { class: 'pbubble' }, h('button', { class: 'bb-x', onclick: () => this.hide() }, '✕'), content);
    document.body.append(el);
    const w = Math.min(360, window.innerWidth - 24);
    el.style.width = w + 'px';
    el.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
    el.style.top = (r.bottom + 8) + 'px';
    el.style.maxHeight = (window.innerHeight - r.bottom - 24) + 'px';
    const tip = h('i', { class: 'bb-tip' });
    tip.style.left = Math.max(14, Math.min(w - 14, r.left + r.width / 2 - parseFloat(el.style.left))) + 'px';
    el.append(tip);
    this.el = el;
    setTimeout(() => {
      this._off = e => { if (this.el && !this.el.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) this.hide(); };
      document.addEventListener('pointerdown', this._off, true);
    }, 0);
  },
  hide(keepRect) {
    if (this._off) document.removeEventListener('pointerdown', this._off, true);
    this._off = null;
    this.el?.remove();
    this.el = null;
    if (!keepRect) this.rect = null;
  },
};
