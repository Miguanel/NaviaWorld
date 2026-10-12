/* Komunikacja z serwerem gry + budzenie uśpionego serwera (darmowy hosting usypia go po bezczynności) */
const Store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* tryb prywatny */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
};

/* ----------------------------------------------------------------- Budzik serwera */
const Wake = {
  ready: false,
  pending: null,
  lines: [
    'Rozpalam ogniska w obozach…', 'Strzygi przeciągają się w kryptach…', 'Kruki zlatują się na rozstaje…',
    'Mgła podnosi się znad bagien…', 'Zielarka zdejmuje pęki ziół spod strzechy…', 'Kowal rozdmuchuje żar w kuźni…',
    'Żercy zapalają ogień przed gontyną…', 'Leszy budzi się w głębi boru…', 'Utopce wypływają spod lilii…',
  ],

  /** Jedno szybkie sprawdzenie, czy serwer (i baza) odpowiadają. */
  async ping(timeoutMs = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch('/api/health?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
      // odpowiedź musi pochodzić z naszego serwera, a nie ze strony zastępczej hostingu
      if (!res.ok || res.headers.get('X-Navia') !== '1') return false;
      const data = await res.json();
      return !!data.ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(t);
    }
  },

  /** Czeka, aż serwer się obudzi. Ekran budzenia pokazuje się dopiero, gdy trwa to dłużej niż chwilę. */
  until() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const started = Date.now();
      let shown = false;
      const showTimer = setTimeout(() => { shown = true; this.show(); }, 700);
      let i = 0;
      while (true) {
        if (await this.ping()) break;
        const sec = (Date.now() - started) / 1000;
        if (!shown) { clearTimeout(showTimer); shown = true; this.show(); }
        this.progress(sec, i++);
        if (sec > 240) {
          clearTimeout(showTimer);
          await this.giveUp();
          this.pending = null;
          return this.until();
        }
        await new Promise(r => setTimeout(r, 2500));
      }
      clearTimeout(showTimer);
      this.ready = true;
      this.hide();
    })().finally(() => { this.pending = null; });
    return this.pending;
  },

  el() { return document.getElementById('wake'); },
  show() { const e = this.el(); if (e) { e.classList.remove('hidden'); requestAnimationFrame(() => e.classList.add('on')); } },
  hide() {
    const e = this.el();
    if (!e) return;
    e.classList.remove('on');
    setTimeout(() => e.classList.add('hidden'), 400);
  },
  progress(sec, i) {
    const e = this.el();
    if (!e) return;
    const line = e.querySelector('[data-wake-line]');
    const hint = e.querySelector('[data-wake-hint]');
    const bar = e.querySelector('[data-wake-bar]');
    if (line) line.textContent = this.lines[i % this.lines.length];
    if (bar) bar.style.width = Math.min(95, sec / 70 * 100) + '%';
    if (hint) {
      hint.textContent = sec < 8 ? '' : sec < 75
        ? 'Świat zasnął, bo przez chwilę nikt nie grał. Budzenie trwa zwykle do minuty.'
        : 'Serwer śpi wyjątkowo twardo… jeszcze chwila.';
    }
  },
  giveUp() {
    return new Promise(resolve => {
      const e = this.el();
      const hint = e && e.querySelector('[data-wake-hint]');
      const btn = e && e.querySelector('[data-wake-retry]');
      if (hint) hint.textContent = 'Nie udało się obudzić serwera. Sprawdź internet i spróbuj ponownie.';
      if (!btn) return resolve();
      btn.classList.remove('hidden');
      btn.onclick = () => { btn.classList.add('hidden'); resolve(); };
    });
  },

  /** Podtrzymanie: dopóki gra jest otwarta i widoczna, serwer nie zaśnie. */
  keepAlive() {
    if (this._ka) return;
    this._ka = setInterval(() => {
      if (document.visibilityState === 'visible') this.ping(10000);
    }, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      // po powrocie do aplikacji (np. po godzinie w kieszeni) sprawdź, czy serwer nie zasnął
      if (document.visibilityState === 'visible') this.ping(4000).then(ok => { if (!ok) this.until(); });
    });
  },
};

/* ----------------------------------------------------------------- API */
const API = {
  token: Store.get('navia_token'),

  async call(method, path, body, retried = false) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
    if (this.token) opts.headers.Authorization = 'Bearer ' + this.token;
    if (body !== undefined) opts.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch('/api' + path, opts);
    } catch (e) {
      if (!retried) { await Wake.until(); return this.call(method, path, body, true); }
      throw new Error('Brak połączenia z serwerem.');
    }
    // odpowiedź nie od naszego serwera (hosting dopiero go budzi) albo 502/503 — obudź i ponów raz
    if ((res.headers.get('X-Navia') !== '1' || res.status === 502 || res.status === 503) && !retried) {
      await Wake.until();
      return this.call(method, path, body, true);
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* */ }
    if (res.status === 401) {
      this.setToken(null);
      if (typeof Game !== 'undefined') Game.showLogin();
      throw new Error(data.error || 'Zaloguj się.');
    }
    if (!res.ok) throw new Error(data.error || ('Błąd serwera (' + res.status + ')'));
    return data;
  },
  get(p) { return this.call('GET', p); },
  post(p, b) { return this.call('POST', p, b || {}); },
  del(p) { return this.call('DELETE', p); },
  setToken(t) { this.token = t; if (t) Store.set('navia_token', t); else Store.del('navia_token'); },
};
