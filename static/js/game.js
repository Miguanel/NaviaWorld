/* Główna logika klienta gry */
function distM(a, b, c, d) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dp = toR(c - a), dl = toR(d - b);
  const s = Math.sin(dp / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const Game = {
  cfg: null,
  content: null,
  state: null,
  mode: Store.get('navia_mode') || 'normalny',
  gps: false,
  watchId: null,
  teleport: false,
  step: 25,
  pos: null,
  worldAt: null,
  moveTimer: null,
  busy: false,

  async boot() {
    // Aplikacja ładuje się od razu z pamięci telefonu, a w tym czasie budzi serwer.
    this.registerSW();
    await Wake.until();
    Wake.keepAlive();
    try {
      this.cfg = await API.get('/config');
      this.content = await API.get('/content');
    } catch (e) {
      document.body.innerHTML = `<div style="padding:30px;font-family:serif;color:#e6d9bd">Serwer gry nie odpowiada.<br><br>${esc(e.message)}<br><br><button onclick="location.reload()">Spróbuj ponownie</button></div>`;
      return;
    }
    document.title = this.cfg.name;
    $$('[data-game-name]').forEach(e => { e.textContent = this.cfg.name; });
    $$('[data-game-subtitle]').forEach(e => { e.textContent = this.cfg.subtitle.toUpperCase(); });
    this.bindStatic();
    if (API.token) {
      try { await this.start(); return; } catch (e) { /* token wygasł */ }
    }
    this.showLogin();
  },

  registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.installEvt = e;
      $('#install-btn').classList.remove('hidden');
      $('#btn-install').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      this.installEvt = null;
      $('#install-btn').classList.add('hidden');
      $('#btn-install').classList.add('hidden');
      toast('Aplikacja zainstalowana — znajdziesz ją na ekranie głównym.', 'good');
    });
    const install = () => this.install();
    $('#install-btn').addEventListener('click', install);
    $('#btn-install').addEventListener('click', install);
  },

  get isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  },

  async install() {
    if (this.installEvt) {
      this.installEvt.prompt();
      await this.installEvt.userChoice;
      this.installEvt = null;
      $('#install-btn').classList.add('hidden');
      $('#btn-install').classList.add('hidden');
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    Modal.open([
      h('div', { class: 'event-kicker' }, 'Aplikacja'),
      h('h2', { class: 'event-title' }, 'Zainstaluj grę'),
      h('p', { class: 'event-text' }, ios
        ? 'W Safari dotknij przycisku Udostępnij (kwadrat ze strzałką), a potem „Do ekranu początkowego”.'
        : 'Otwórz menu przeglądarki (⋮) i wybierz „Zainstaluj aplikację” albo „Dodaj do ekranu głównego”.'),
      h('p', { class: 'muted' }, 'Zainstalowana gra otwiera się na pełnym ekranie i ładuje od razu z pamięci telefonu — w tle sama budzi serwer.'),
      h('button', { class: 'btn block', style: { marginTop: '12px' }, onclick: () => Modal.close() }, 'Rozumiem'),
    ]);
  },

  showLogin() {
    $('#login').classList.remove('hidden');
    ['#hud', '#side', '#bottom', '#dpad'].forEach(s => $(s).classList.add('hidden'));
  },

  async auth(kind) {
    const u = $('#lg-user').value.trim(), p = $('#lg-pass').value;
    $('#login-err').textContent = '';
    try {
      const r = await API.post('/' + kind, { username: u, password: p });
      API.setToken(r.token);
      await this.start();
      if (kind === 'register') this.welcome(r.is_admin);
    } catch (e) { $('#login-err').textContent = e.message; }
  },

  welcome(isAdmin) {
    Modal.open([
      h('div', { class: 'event-kicker' }, 'Prolog'),
      h('h2', { class: 'event-title' }, 'Budzisz się na rozstajach'),
      h('p', { class: 'event-text' }, 'W sakwie masz siekierę, sierp, krzesiwo, moździerz i dwa wywary z krwawnika. Za pasem kord. Wokół — ziemia, która pamięta starych bogów i to, co po nich zostało.'),
      h('ul', { class: 'loot-list' },
        h('li', {}, 'Chodź po świecie (GPS albo strzałki w trybie debug). Tereny i punkty mocy zmieniają to, co możesz spotkać.'),
        h('li', {}, 'Eksploracja zużywa energię (+' + this.cfg.modes.latwy.cost + '…' + this.cfg.modes.specjalny.cost + ' pkt). Energia odnawia się co godzinę.'),
        h('li', {}, 'W lesie zetniesz drewno i zbierzesz zioła. Z 4 polan i krzesiwa rozbijesz obóz.'),
        h('li', {}, 'W Torbie przeciągaj przedmioty jeden na drugi — zobaczysz, co z nich powstanie.'),
        isAdmin ? h('li', {}, 'Jesteś pierwszym łowcą, więc masz dostęp do panelu admina (⚙).') : null),
      h('button', { class: 'btn primary block', style: { marginTop: '14px' }, onclick: () => Modal.close() }, 'Ruszam'),
    ]);
  },

  async start() {
    const r = await API.get('/state');
    $('#login').classList.add('hidden');
    ['#hud', '#side', '#bottom'].forEach(s => $(s).classList.remove('hidden'));
    this.debugTools = this.cfg.debug || !!r.state.char.is_admin;  // admin ma strzałki także na produkcji
    $('#dpad').classList.toggle('hidden', !this.debugTools);
    $('#btn-teleport').classList.toggle('hidden', !this.debugTools);
    const ch = r.state.char;
    this.pos = [ch.lat, ch.lng];
    if (!MapView.map) MapView.init(this.content, ch.lat, ch.lng);
    if (!MapView.disabled) MapView.meRange.setRadius(this.cfg.interact_radius);
    this.applyState(r.state);
    this.loadWorld(true);
    Finder.restore();
    clearInterval(this._iv1); clearInterval(this._iv2);
    this._iv1 = setInterval(() => this.refresh(), 30000);
    this._iv2 = setInterval(() => this.loadWorld(), 25000);
    if (!this.cfg.debug || Store.get('navia_gps') === '1') this.startGps();
  },

  bindStatic() {
    $('#login-form').addEventListener('submit', e => { e.preventDefault(); this.auth('login'); });
    $('[data-act="register"]').addEventListener('click', () => this.auth('register'));
    $$('[data-open]').forEach(b => b.addEventListener('click', () => this.openSheet(b.dataset.open)));
    $('#sheet-close').addEventListener('click', () => Sheet.close());
    $('#scrim').addEventListener('click', () => Sheet.close());
    $('#btn-center').addEventListener('click', () => MapView.center());
    $('#btn-find').addEventListener('click', () => Finder.open());
    $('#btn-gps').addEventListener('click', () => (this.gps ? this.stopGps() : this.startGps()));
    $('#btn-teleport').addEventListener('click', () => {
      this.teleport = !this.teleport;
      $('#btn-teleport').classList.toggle('on', this.teleport);
      toast(this.teleport ? 'Teleport: kliknij mapę, żeby się przenieść.' : 'Teleport wyłączony.');
    });
    $('#btn-admin').addEventListener('click', () => { location.href = '/admin'; });
    $$('#dpad [data-move]').forEach(b => b.addEventListener('click', () => {
      const s = this.step;
      const d = { n: [s, 0], s: [-s, 0], e: [0, s], w: [0, -s] }[b.dataset.move];
      this.nudge(d[0], d[1]);
    }));
    $('#dpad-step').addEventListener('click', () => {
      const steps = [10, 25, 100, 400];
      this.step = steps[(steps.indexOf(this.step) + 1) % steps.length];
      $('#dpad-step').textContent = this.step + ' m';
    });
    document.addEventListener('keydown', e => {
      if (!this.debugTools || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      const k = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (k) { e.preventDefault(); this.nudge(k[0] * this.step, k[1] * this.step); }
    });
    $('#explore-btn').addEventListener('click', () => this.explore());
    $('#omen-link').addEventListener('click', () => this.showOmens());
    $('#auto-btn').addEventListener('click', () => AutoScan.open());
    $('#btn-logout').addEventListener('click', () => this.logout());
  },

  async logout(ask = true) {
    if (ask && !confirm('Wylogować się z gry? Postać i torba zostaną na serwerze.')) return;
    if (typeof AutoScan !== 'undefined' && AutoScan.running) AutoScan.running = false;
    try { await API.post('/logout'); } catch (e) { /* i tak czyścimy */ }
    API.setToken(null);
    Store.del('navia_trail');
    location.reload();
  },

  // ----------------------------------------------------------- stan
  async refresh() {
    if (!API.token || Combat.view) return;
    try { const r = await API.get('/state'); this.applyState(r.state, { silent: true }); } catch (e) { /* */ }
  },

  applyState(st, { silent, noCombat } = {}) {
    const prev = this.state;
    this.state = st;
    this.renderHud();
    this.renderCtx();
    this.renderNearby();
    this.renderModes();
    document.body.classList.toggle('night', !!st.ctx.night);
    $('#btn-admin').classList.toggle('hidden', !st.char.is_admin);
    if (st.combat && !Combat.view && !noCombat && !Modal.isOpen) Combat.open(st.combat);
    if (prev && st.char.level > prev.char.level) toast(`Poziom ${st.char.level}! Masz punkty cech do rozdania.`, 'good');
    if (Sheet.current && Sheet.current !== 'recipes' && !Bag.drag) Sheet.refresh();
  },

  statName(s) { return (this.cfg.stat_names || {})[s] || s; },
  fmtStats(o) { return Object.entries(o || {}).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${this.statName(k)}`).join(', '); },

  renderHud() {
    const c = this.state.char;
    $('#h-name').textContent = c.name;
    $('#h-lvl').textContent = `poziom ${c.level} · ${c.xp}/${c.xp_next} PD`;
    $('#h-coins').textContent = money(c.coins);
    bar($('#b-hp'), c.hp, c.max_hp); $('#t-hp').textContent = `Zdrowie ${Math.round(c.hp)}/${c.max_hp}`;
    bar($('#b-vig'), c.vigor, c.max_vigor); $('#t-vig').textContent = `Wigor ${Math.round(c.vigor)}/${c.max_vigor} · +${c.vigor_per_meter}/m`;
    bar($('#b-tox'), c.toxicity, c.max_tox); $('#t-tox').textContent = `Toksyny ${Math.round(c.toxicity)}/${c.max_tox}`;
    bar($('#b-en'), c.energy, c.max_energy); $('#t-en').textContent = `Energia ${Math.floor(c.energy)}/${c.max_energy} · +${c.energy_per_hour}/h`;
    bar($('#b-xp'), c.xp, c.xp_next);
    $('#stat-badge').classList.toggle('hidden', !c.stat_points);
  },

  renderCtx() {
    const x = this.state.ctx;
    const t = this.content.terrains[x.primary] || {};
    const box = $('#ctxbar');
    box.innerHTML = '';
    box.append(h('button', { class: 'chip ctx-terrain', style: { '--tc': t.color }, title: 'Jak ten teren na ciebie działa?', onclick: e => this.showInfluence(e.currentTarget, 'terrain:' + x.primary) },
      h('span', { style: { color: t.color } }, '■'), x.zone_name && x.zone_name !== x.primary_name ? `${x.primary_name} · ${x.zone_name}` : x.primary_name,
      Object.keys(x.terrains).length > 1 ? h('small', {}, ` +${Object.keys(x.terrains).length - 1}`) : null));
    if (x.night) box.append(h('button', { class: 'chip ctx-night', onclick: e => this.showInfluence(e.currentTarget, 'night') }, '☾ noc'));
    for (const p of x.powers.slice(0, 4)) {
      const k = this.content.power_kinds[p.kind] || {};
      box.append(h('button', { class: 'chip', style: { borderColor: k.color }, title: 'Jak ten punkt mocy na ciebie działa?', onclick: e => this.showInfluence(e.currentTarget, 'power:' + p.id) },
        h('span', { style: { color: k.color } }, p.glyph), `${p.name || p.kind_name} ${Math.round(p.infl * 100)}%`));
    }
    if (typeof Finder !== 'undefined' && Finder.active) {
      const n = Finder.nearest();
      box.append(h('button', { class: 'chip trail', onclick: () => Finder.showLeads(Finder.active.res) },
        g(Finder.active.item.glyph), ` ${Finder.active.item.name}${n ? ' · ' + (n.d < 30 ? 'tutaj' : `${fmtDist(n.d)} · ${Math.round(bearingDeg(this.pos[0], this.pos[1], n.l.lat, n.l.lng))}°`) : ''}`));
    }
    for (const e of this.state.char.effects.slice(0, 3)) {
      box.append(h('button', { class: 'chip', style: { borderColor: 'var(--moss)' }, onclick: ev => Bubble.show(ev.currentTarget, [
        h('div', { class: 'bb-title' }, '✧ ', e.name),
        h('div', { class: 'bb-stats' }, Object.entries(e.stats || {}).map(([k, v]) => this.statChip(k, v))),
        h('div', { class: 'faint' }, `Mija za ${fmtTime(e.left)}.`)]) }, '✧ ' + e.name));
    }
  },

  statChip(k, v) {
    const r = Math.round(v * 10) / 10;
    return h('span', { class: 'bb-stat ' + (r >= 0 ? 'up' : 'down') }, `${r > 0 ? '+' : ''}${String(r).replace('.', ',')} ${this.statName(k)}`);
  },

  /** Dymek: jak teren / punkt mocy / noc wpływa na cechy i szanse zdarzeń */
  async showInfluence(anchor, what) {
    const pct = v => (v < 10 ? String(Math.round(v * 10) / 10).replace('.', ',') : Math.round(v)) + '%';
    Bubble.show(anchor, h('div', { class: 'muted' }, 'Wsłuchuję się w okolicę…'));
    let r;
    try { r = await API.get('/influence?what=' + encodeURIComponent(what)); } catch (e) { return Bubble.show(anchor, h('div', {}, e.message)); }
    const kindName = { monster: 'potwór', item: 'znalezisko', story: 'zdarzenie' };
    const x = this.state.ctx;
    const others = what.startsWith('terrain:') ? Object.entries(x.terrains).filter(([k]) => 'terrain:' + k !== what) : [];
    const parts = [
      h('div', { class: 'bb-title' }, h('span', { style: { color: r.color || 'inherit' } }, r.glyph || ''), ' ', r.title,
        r.infl != null ? h('span', { class: 'bb-infl' }, `siła ${Math.round(r.infl * 100)}%`) : null),
      r.desc ? h('p', { class: 'bb-desc' }, r.desc) : null,
    ];
    const st = Object.entries(r.stats || {}).filter(([, v]) => Math.abs(v) >= 0.05);
    parts.push(h('div', { class: 'bb-sec' }, 'Wpływ na cechy'),
      st.length ? h('div', { class: 'bb-stats' }, st.map(([k, v]) => this.statChip(k, v))) : h('div', { class: 'faint' }, 'Nie zmienia twoich cech.'));
    parts.push(h('div', { class: 'bb-sec' }, 'Szanse na zdarzenia (tryb normalny)'));
    if (!r.changes.length) parts.push(h('div', { class: 'faint' }, 'Nie zmienia wyraźnie tego, co możesz spotkać.'));
    for (const c of r.changes) {
      const up = c.now > c.without;
      parts.push(h('div', { class: 'bb-row' },
        h('span', { class: 'bb-l' }, c.label, h('small', {}, ' ' + (kindName[c.kind] || ''))),
        h('span', { class: 'bb-v ' + (up ? 'up' : 'down') },
          c.without ? `${pct(c.without)} → ${pct(c.now)}` : `tylko tu: ${pct(c.now)}`,
          c.ratio ? h('small', {}, ` ×${String(c.ratio).replace('.', ',')}`) : null)));
    }
    if (r.gathers?.length) {
      parts.push(h('div', { class: 'bb-sec' }, 'Można tu zbierać'),
        h('div', { class: 'bb-stats' }, r.gathers.map(gt => h('span', { class: 'bb-stat' }, `${gt.name}${gt.tool ? ` (${gt.tool})` : ''} · ${gt.vigor} wig.`))));
    }
    for (const n of r.notes || []) parts.push(h('div', { class: 'faint', style: { marginTop: '6px', fontSize: '12px' } }, n));
    if (others.length) {
      parts.push(h('div', { class: 'bb-sec' }, 'Inne tereny w tym miejscu'),
        h('div', { class: 'bb-stats' }, others.map(([k, v]) => h('button', { class: 'bb-stat link', onclick: () => this.showInfluence(anchor, 'terrain:' + k) }, `${this.content.terrains[k]?.name || k} ${Math.round(v * 100)}%`))));
    }
    Bubble.show(anchor, parts);
  },

  renderNearby() {
    const st = this.state;
    const box = $('#nearby');
    box.innerHTML = '';
    for (const b of st.ctx.buildings) {
      box.append(h('button', { class: 'chip building', onclick: () => this.openBuilding(b.id) }, g(b.glyph), `${b.name || b.kind_name} — wejdź`));
    }
    if (st.site.in_camp || st.site.at_base) {
      box.append(h('button', { class: 'chip camp', onclick: () => (st.site.at_own_base ? this.openSite('base') : st.site.my_camp ? this.openSite('camp') : this.openSheet('camp')) }, g(st.site.at_base ? '🏚️' : '🔥'), st.site.at_base ? ' Siedlisko' : ' Obóz'));
    }
    for (const gth of st.gathers) {
      const dis = !gth.has_tool || gth.cooldown_left > 0;
      box.append(h('button', {
        class: 'chip', disabled: dis, style: dis ? { opacity: .5 } : null,
        title: gth.has_tool ? `${gth.vigor} wigoru` : `Potrzebujesz: ${gth.tool_name}`,
        onclick: () => this.gather(gth.id),
      }, gth.name, gth.cooldown_left > 0 ? ` (${gth.cooldown_left}s)` : !gth.has_tool ? ' ✕' : ''));
    }
  },

  renderModes() {
    const box = $('#modes');
    box.innerHTML = '';
    const en = this.state.char.energy;
    for (const [id, m] of Object.entries(this.state.energy_modes)) {
      box.append(h('button', {
        class: 'mode' + (this.mode === id ? ' on' : ''), title: m.desc, style: en < m.cost ? { opacity: .45 } : null,
        onclick: () => { this.mode = id; Store.set('navia_mode', id); this.renderModes(); },
      }, h('b', {}, `${m.cost} `, g('⚡')), m.name));
    }
    const auto = typeof AutoScan !== 'undefined' && AutoScan.running;
    $('#explore-btn').disabled = en < (this.state.energy_modes[this.mode]?.cost || 1) || this.busy || auto;
    $('#auto-btn').classList.toggle('on', auto);
    $('#auto-btn').textContent = auto ? '■ Zatrzymaj auto-skan' : '⟳ Auto-skan';
  },

  // ----------------------------------------------------------- ruch
  nudge(dn, de) {
    if (this.gps) this.stopGps();
    const [lat, lng] = this.pos;
    const nlat = lat + dn / 111320;
    const nlng = lng + de / (111320 * Math.cos(lat * Math.PI / 180));
    this.setPosition(nlat, nlng);
  },

  setPosition(lat, lng) {
    this.pos = [lat, lng];
    MapView.setMe(lat, lng);
    if (Finder.active) { Finder.check(); this.renderCtx(); }
    clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(() => this.sendMove(), this.gps ? 1500 : 250);
  },

  async sendMove() {
    try {
      const r = await API.post('/move', { lat: this.pos[0], lng: this.pos[1] });
      this.applyState(r.state, { silent: true });
      if (r.result && r.result.vigor_gained >= 1) this.vigorBlip(r.result.vigor_gained);
      if (!this.worldAt || distM(this.worldAt[0], this.worldAt[1], this.pos[0], this.pos[1]) > 250) this.loadWorld(true);
    } catch (e) { toast(e.message, 'err'); }
  },

  vigorBlip(n) {
    const el = $('#t-vig');
    if (!el) return;
    const b = h('span', { class: 'energy-blip' }, `+${Math.round(n)}`);
    el.parentElement.append(b);
    setTimeout(() => b.remove(), 1200);
  },

  openMerchant(id) { Market.open(id); },
  clearTrail() { Finder.clear(); MapView.map.closePopup(); },
  focusLead(i) {
    const l = Finder.active && Finder.active.leads[i];
    if (!l || MapView.disabled) return;
    MapView.follow = false;
    MapView.map.closePopup();
    MapView.map.setView([l.lat, l.lng], Math.max(16, MapView.map.getZoom()));
  },

  startGps() {
    if (!navigator.geolocation) return toast('Ta przeglądarka nie ma GPS.', 'err');
    this.gps = true;
    Store.set('navia_gps', '1');
    $('#btn-gps').classList.add('on');
    this.watchId = navigator.geolocation.watchPosition(
      p => this.setPosition(p.coords.latitude, p.coords.longitude),
      err => { toast('GPS: ' + (err.code === 1 ? 'brak zgody na lokalizację' : 'brak sygnału') + (this.debugTools ? ' — użyj strzałek.' : ''), 'err'); this.stopGps(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  },

  stopGps() {
    this.gps = false;
    Store.set('navia_gps', '0');
    $('#btn-gps').classList.remove('on');
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  },

  async loadWorld(force) {
    if (!this.pos) return;
    try {
      const w = await API.get(`/world?lat=${this.pos[0]}&lng=${this.pos[1]}`);
      this.worldAt = [...this.pos];
      MapView.render(w);
      this.world = w;
    } catch (e) { /* */ }
  },

  onMapClick(ll) {
    if (this.pick) { const cb = this.pick; this.endPick(); cb(ll); return; }
    if (this.teleport && this.debugTools) { if (this.gps) this.stopGps(); this.setPosition(ll.lat, ll.lng); }
  },

  /** Tryb wskazywania miejsca na mapie (budowa, przenoszenie obozu) */
  pickOnMap(text, cb) {
    if (MapView.disabled) return toast('Mapa niedostępna.', 'err');
    Modal.close(); Sheet.close();
    this.pick = cb;
    document.body.classList.add('picking');
    const b = $('#pick-banner');
    b.querySelector('[data-pick-text]').textContent = text;
    b.querySelector('[data-pick-cancel]').onclick = () => this.endPick();
    b.classList.remove('hidden');
  },
  endPick() {
    this.pick = null;
    document.body.classList.remove('picking');
    $('#pick-banner').classList.add('hidden');
  },

  // ----------------------------------------------------------- obóz / siedlisko: plan i rozbudowa
  async openSite(kind, owner) {
    try {
      const v = await API.get(`/site/${kind}` + (owner ? `?owner=${owner}` : ''));
      if (!v) return toast(kind === 'camp' ? 'Nie masz rozbitego obozu.' : 'Brak siedliska.', 'err');
      MapView.map && MapView.map.closePopup();
      this.renderSite(v);
    } catch (e) { toast(e.message, 'err'); }
  },

  async siteAction(path, body, v) {
    try {
      const r = await API.post(path, body);
      this.applyState(r.state, { silent: true });
      toastAll(r.result.messages, 'good');
      await this.loadWorld();
      if (v) this.openSite(v.type, v.type === 'base' ? v.owner_id : undefined);
    } catch (e) { toast(e.message, 'err'); }
  },

  renderSite(v) {
    const isCamp = v.type === 'camp';
    const own = isCamp || v.own;
    const where = isCamp ? 'camp' : 'base';
    const conn = v.structures.filter(s => s.connected).length;
    const parts = [
      h('div', { class: 'row' }, h('span', { style: { fontSize: '44px' } }, g(isCamp ? '🔥' : '🏚️')),
        h('div', {}, h('div', { class: 'event-kicker' }, isCamp ? 'Twój obóz' : (v.own ? 'Twoje siedlisko' : 'Siedlisko gościnne')),
          h('h2', { style: { fontSize: '26px' } }, v.name))),
      h('p', { class: 'muted' }, (isCamp ? `Ogień dogaśnie za ${v.left_h} h. ` : '') +
        `Centrum ma krąg ${v.radius} m. Połączonych budynków: ${conn} z ${v.structures.length}.`),
      h('div', { class: 'octo-hint' }, 'Każdy budynek ma mały krąg. Jeśli styka się z centrum albo z innym połączonym budynkiem, ich obszary zlewają się w jedną „ośmiornicę” — w całym jej zasięgu korzystasz z każdego połączonego budynku. Budynek postawiony osobno działa tylko, gdy stoisz w jego kręgu.'),
      h('div', { class: 'section-title' }, 'Budynki'),
    ];
    if (!v.structures.length) parts.push(h('p', { class: 'muted' }, 'Jeszcze nic tu nie stoi.'));
    for (const s of v.structures) {
      const cost = (s.repair_cost || []).map(r => `${this.content.items[r.item]?.name || r.item} ×${r.qty}`).join(', ');
      const d = distM(this.pos[0], this.pos[1], s.lat, s.lng);
      parts.push(h('div', { class: 'site-struct' },
        h('span', { class: 'sg' }, g(s.glyph)),
        h('div', {},
          h('div', { class: 'row' }, h('strong', {}, s.name), h('span', { class: 'spacer' }),
            h('span', { class: 'chip ' + (s.connected ? 'ok' : 'warn') }, s.connected ? 'połączony' : 'osobno')),
          h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } }, h('div', { class: 'dur' }, h('i', { style: { width: s.pct + '%' } })),
            h('span', { class: 'faint', style: { fontSize: '12px' } }, `${s.pct}% · krąg ${Math.round(s.radius)} m · ${fmtDist(d)} stąd`)),
          h('div', { class: 'row wrap', style: { marginTop: '6px' } },
            h('button', { class: 'btn small', onclick: () => this.siteAction('/structure/repair', { id: s.id }, v) }, 'Napraw' + (cost ? ` (${cost})` : '')),
            own ? h('button', { class: 'btn small ghost', onclick: () => this.siteAction('/structure/pickup', { id: s.id }, v) }, 'Zabierz') : null,
            h('button', { class: 'btn small ghost', onclick: () => { Modal.close(); MapView.follow = false; MapView.map.setView([s.lat, s.lng], 18); } }, 'Pokaż')))));
    }
    if (own) {
      parts.push(h('div', { class: 'section-title' }, isCamp ? 'Rozbudowa obozu' : 'Rozbudowa siedliska'));
      const placeable = this.state.inventory.filter(i => i.placeable);
      if (!placeable.length) {
        parts.push(h('p', { class: 'muted' }, 'Nie masz w torbie żadnego budynku. Wytwórz go w Księdze receptur: kamienne palenisko, stół zielarza, suszarnię, ołtarzyk Welesa, kocioł, kowadło…'),
          h('button', { class: 'btn small', onclick: () => { Modal.close(); this.openSheet('recipes'); } }, 'Otwórz Księgę receptur'));
      }
      for (const it of placeable) {
        parts.push(h('div', { class: 'row wrap', style: { padding: '6px 0', borderBottom: '1px solid rgba(59,50,41,.5)' } },
          g(it.glyph), h('span', { style: { flex: 1 } }, `${it.name} ×${it.qty}`),
          h('button', { class: 'btn small', onclick: () => this.siteAction('/structure/place', { item: it.id, where }, v) }, 'Postaw tutaj'),
          h('button', { class: 'btn small', onclick: () => this.pickOnMap(`Wskaż, gdzie postawić: ${it.name} (do ${this.cfg.build_reach} m od ciebie).`,
            ll => this.siteAction('/structure/place', { item: it.id, where, lat: ll.lat, lng: ll.lng }, v)) }, 'Wskaż na mapie')));
      }
      parts.push(h('div', { class: 'section-title' }, 'Przeniesienie'),
        h('p', { class: 'muted', style: { marginTop: 0 } }, `Wszystkie budynki przeniosą się razem z ${isCamp ? 'obozem' : 'siedliskiem'}, zachowując układ.`),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn small', onclick: () => this.pickOnMap(`Wskaż nowe miejsce ${isCamp ? 'obozu' : 'siedliska'} na mapie.`,
            ll => this.siteAction('/site/move', { where, lat: ll.lat, lng: ll.lng }, v)) }, '✥ Wskaż na mapie'),
          h('button', { class: 'btn small ghost', onclick: () => this.siteAction('/site/move', { where, lat: this.pos[0], lng: this.pos[1] }, v) }, 'Przenieś tutaj')));
      if (isCamp) parts.push(h('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: () => this.siteAction('/camp/feed', {}, v) }, 'Dorzuć 2 drewna (+6 h)'));
    }
    parts.push(h('button', { class: 'btn ghost block', style: { marginTop: '14px' }, onclick: () => Modal.close() }, 'Zamknij'));
    Modal.open(parts);
  },

  // ----------------------------------------------------------- eksploracja
  async explore() {
    if (this.busy || (typeof AutoScan !== 'undefined' && AutoScan.running)) return;
    this.busy = true;
    const btn = $('#explore-btn');
    btn.classList.add('busy'); btn.disabled = true;
    try {
      const [r] = await Promise.all([API.post('/explore', { mode: this.mode }), new Promise(rs => setTimeout(rs, 700))]);
      this.applyState(r.state, { silent: true, noCombat: true });
      this.showEvent(r.result);
    } catch (e) { toast(e.message, 'err'); }
    this.busy = false;
    btn.classList.remove('busy');
    this.renderModes();
  },

  showEvent(res) {
    const kinds = { monster: 'Spotkanie', item: 'Znalezisko', story: 'Zdarzenie' };
    const m = this.state.energy_modes[res.mode] || {};
    const card = [
      h('div', { class: 'event-kicker' }, `${kinds[res.event.kind] || ''} · tryb ${m.name || ''} · szansa ${res.event.pct}%`),
      h('h2', { class: 'event-title' }, res.combat ? res.combat.name : res.event.name),
      h('p', { class: 'event-text' }, res.text || '…'),
      res.messages.length ? h('ul', { class: 'loot-list' }, res.messages.map(x => h('li', {}, x))) : null,
    ];
    if (res.combat) {
      card.push(h('button', { class: 'btn primary block', style: { marginTop: '16px' }, onclick: () => { Modal.close(); Combat.open(this.state.combat); } }, '⚔ Do walki'));
      Modal.open(card, { dismissable: false });
    } else {
      card.push(h('button', { class: 'btn block', style: { marginTop: '16px' }, onclick: () => Modal.close() }, 'Dalej'));
      Modal.open(card);
    }
  },

  showOmens() {
    const list = this.state.omens[this.mode] || [];
    const x = this.state.ctx;
    const m = this.state.energy_modes[this.mode];
    const max = Math.max(1, ...list.map(l => l.pct));
    Modal.open([
      h('div', { class: 'event-kicker' }, `Tryb ${m.name} · ${m.cost} energii`),
      h('h2', { class: 'event-title' }, 'Szepty okolicy'),
      h('p', { class: 'muted' }, `Teren: ${Object.entries(x.terrains).map(([k, v]) => `${this.content.terrains[k]?.name || k} ${Math.round(v * 100)}%`).join(', ')}. ` +
        (x.powers.length ? `Punkty mocy: ${x.powers.map(p => `${p.name || p.kind_name} ${Math.round(p.infl * 100)}%`).join(', ')}. ` : 'Brak punktów mocy w pobliżu. ') +
        (x.night ? 'Jest noc — upiory są śmielsze.' : 'Jest dzień.')),
      h('div', { class: 'ornament' }),
      list.map(l => h('div', { class: 'omen-row' }, h('span', {}, l.label),
        h('div', { class: 'ob' }, h('i', { class: l.kind, style: { width: (100 * l.pct / max) + '%' } })),
        h('span', { class: 'p' }, l.pct + '%'))),
      h('p', { class: 'hint' }, m.desc),
      h('button', { class: 'btn block', style: { marginTop: '10px' }, onclick: () => Modal.close() }, 'Zamknij'),
    ]);
  },

  afterCombat() { this.refresh(); this.loadWorld(); },

  // ----------------------------------------------------------- akcje
  async post(path, body, okToast = true) {
    try {
      const r = await API.post(path, body);
      this.applyState(r.state, { silent: true });
      if (okToast && r.result?.messages) toastAll(r.result.messages, 'good');
      return r.result;
    } catch (e) { toast(e.message, 'err'); return null; }
  },

  async gather(id) {
    const res = await this.post('/gather', { id }, false);
    if (res) { toast(res.text); toastAll([...res.loot, ...res.messages], 'good'); }
  },
  async useItem(id) { Modal.close(); await this.post('/use', { item: id }); },
  async drop(id) { Modal.close(); await this.post('/drop', { item: id, qty: 1 }); },
  async place(id, where) { Modal.close(); const r = await this.post('/structure/place', { item: id, where }); if (r) this.loadWorld(); },

  // ----------------------------------------------------------- budynki
  tapBuilding(b) {
    const d = distM(this.pos[0], this.pos[1], b.lat, b.lng);
    const bt = this.content.building_types[b.kind] || {};
    if (d <= this.cfg.interact_radius || MapView.disabled) return this.openBuilding(b.id);
    L.popup().setLatLng([b.lat, b.lng]).setContent(`<h4>${esc(b.name || bt.name)}</h4><div class="sc muted">${esc(bt.name)}</div><p style="margin:.4em 0">${esc(bt.description || '')}</p><div class="muted">Jesteś ${Math.round(d)} m stąd. Podejdź bliżej niż ${this.cfg.interact_radius} m.</div>`).openOn(MapView.map);
  },

  async openBuilding(pid) {
    try {
      const b = await API.get('/building/' + pid);
      this.renderBuilding(b);
    } catch (e) { toast(e.message, 'err'); }
  },

  async buildingAct(b, index, payload) {
    try {
      const r = await API.post('/building/' + b.id, { index, payload });
      this.applyState(r.state, { silent: true, noCombat: true });
      const res = r.result;
      if (res.combat) {
        Modal.close();
        Modal.open([h('div', { class: 'event-kicker' }, 'Spotkanie'), h('h2', { class: 'event-title' }, res.combat.name),
          h('p', { class: 'event-text' }, res.text),
          h('button', { class: 'btn primary block', style: { marginTop: '16px' }, onclick: () => { Modal.close(); Combat.open(this.state.combat); } }, '⚔ Do walki')], { dismissable: false });
        return;
      }
      if (res.bestiary) return this.showBestiary(res.bestiary, b);
      if (res.messages?.length && ['rumors'].includes(b.actions[index].type)) {
        Modal.open([h('div', { class: 'event-kicker' }, b.name), h('h2', { class: 'event-title' }, b.actions[index].label),
          h('p', { class: 'event-text' }, res.text), h('ul', { class: 'loot-list' }, res.messages.map(m => h('li', {}, m))),
          h('button', { class: 'btn block', style: { marginTop: '12px' }, onclick: () => this.renderBuilding(res.building) }, '◂ Wróć')]);
        return;
      }
      toast(res.text, 'good');
      toastAll(res.messages, 'good');
      this.renderBuilding(res.building);
    } catch (e) { toast(e.message, 'err'); }
  },

  showBestiary(list, b) {
    Modal.open([h('div', { class: 'event-kicker' }, b.name), h('h2', { class: 'event-title' }, 'Bestiariusz'),
      list.map(m => h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { style: { fontSize: '30px' } }, g(m.glyph)),
        h('div', {}, h('h3', { style: { fontSize: '20px' } }, m.name), h('div', { class: 'muted sc', style: { fontSize: '12px' } }, `poziom ${m.level} · ${m.family}`))),
        h('p', { style: { margin: '6px 0' } }, m.lore), m.weaknesses.length ? h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Słabości: ' + m.weaknesses.map(w => this.content.items[w]?.name || w).join(', ')) : null)),
      h('button', { class: 'btn block', onclick: () => this.openBuilding(b.id) }, '◂ Wróć')]);
  },

  renderBuilding(b) {
    const ch = this.state.char;
    const parts = [
      h('div', { class: 'row' }, h('span', { style: { fontSize: '48px' } }, g(b.glyph)),
        h('div', {}, h('div', { class: 'event-kicker' }, b.kind_name), h('h2', { style: { fontSize: '27px' } }, b.name))),
      h('p', { class: 'muted', style: { fontStyle: 'italic' } }, b.description),
      h('div', { class: 'ornament' }),
    ];
    const quick = h('div', { class: 'row wrap' });
    for (const a of b.actions) {
      if (['shop', 'sell', 'learn', 'contracts', 'market'].includes(a.type)) continue;
      const cost = a.cost ? ` (${money(a.cost)})` : a.item ? ` (${this.content.items[a.item]?.name})` : '';
      quick.append(h('button', { class: 'btn', onclick: () => this.buildingAct(b, a.index, {}) }, a.label + cost));
    }
    if (quick.childNodes.length) parts.push(quick);
    for (const a of b.actions) {
      if (a.type === 'shop' && b.shop.length) {
        parts.push(h('div', { class: 'section-title' }, a.label));
        parts.push(...b.shop.map(s => h('div', { class: 'row', style: { padding: '5px 0', borderBottom: '1px solid rgba(59,50,41,.5)' } },
          g(s.glyph), h('span', { title: s.description }, s.name), h('span', { class: 'spacer' }), h('span', { class: 'sc muted' }, money(s.price)),
          h('button', { class: 'btn small', disabled: ch.coins < s.price, onclick: () => this.buildingAct(b, a.index, { item: s.item, qty: 1 }) }, 'Kup'))));
      }
      if (a.type === 'market' && b.market) {
        parts.push(h('div', { class: 'section-title' }, a.label));
        parts.push(h('p', { class: 'faint', style: { fontSize: '13px', margin: '0 0 6px' } }, 'Każdego dnia przyjeżdżają inni kupcy z innym towarem.'));
        parts.push(...b.market.map(s => h('div', { class: 'row', style: { padding: '5px 0', borderBottom: '1px solid rgba(59,50,41,.5)' } },
          g(s.glyph), h('span', { title: s.description }, s.name, h('div', { class: 'faint', style: { fontSize: '11px' } }, s.trader)), h('span', { class: 'spacer' }),
          h('span', { class: 'sc muted' }, money(s.price)),
          h('button', { class: 'btn small', disabled: ch.coins < s.price, onclick: () => this.buildingAct(b, a.index, { item: s.item, qty: 1 }) }, 'Kup'))));
      }
      if (a.type === 'sell') {
        parts.push(h('div', { class: 'section-title' }, `${a.label} · ${Math.round(b.sell_rate * 100)}% wartości`));
        if (!b.sellable.length) parts.push(h('div', { class: 'muted' }, 'Nie masz nic na sprzedaż.'));
        parts.push(...b.sellable.map(s => h('div', { class: 'row', style: { padding: '5px 0', borderBottom: '1px solid rgba(59,50,41,.5)' } },
          g(s.glyph), h('span', {}, `${s.name} ×${s.qty}`), h('span', { class: 'spacer' }), h('span', { class: 'sc muted' }, money(s.price)),
          h('button', { class: 'btn small', onclick: () => this.buildingAct(b, a.index, { item: s.item, qty: 1 }) }, '1'),
          s.qty > 1 ? h('button', { class: 'btn small', onclick: () => this.buildingAct(b, a.index, { item: s.item, qty: s.qty }) }, 'Wszystko') : null)));
      }
      if (a.type === 'learn' && b.teaches.length) {
        parts.push(h('div', { class: 'section-title' }, a.label));
        parts.push(...b.teaches.map(t => h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', {}, t.name), h('span', { class: 'spacer' }),
          t.known ? h('span', { class: 'chip' }, 'znasz') : h('button', { class: 'btn small', disabled: ch.coins < t.price || ch.level < t.min_level, onclick: () => this.buildingAct(b, a.index, { recipe: t.recipe }) }, money(t.price))),
          t.description ? h('div', { class: 'muted', style: { fontSize: '13px', marginTop: '4px' } }, t.description) : null,
          t.min_level > 1 ? h('div', { class: 'faint', style: { fontSize: '12px' } }, `od poziomu ${t.min_level}`) : null)));
      }
      if (a.type === 'contracts' && b.contracts) {
        parts.push(h('div', { class: 'section-title' }, a.label));
        parts.push(...b.contracts.map(c => h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', {}, c.title), h('span', { class: 'spacer' }), h('span', { class: 'sc', style: { color: 'var(--gold)' } }, money(c.reward))),
          h('p', { style: { margin: '4px 0', fontSize: '14px' } }, c.text),
          h('div', { class: 'row' }, h('span', { class: 'faint', style: { fontSize: '12px' } }, `poz. ${c.level} · ${c.xp} PD`), h('span', { class: 'spacer' }),
            c.done && !c.claimed ? h('button', { class: 'btn small primary', onclick: () => this.buildingAct(b, a.index, { contract: c.id, op: 'claim' }) }, 'Odbierz nagrodę')
              : c.taken ? h('span', { class: 'chip' }, 'przyjęte') : h('button', { class: 'btn small', onclick: () => this.buildingAct(b, a.index, { contract: c.id, op: 'take' }) }, 'Przyjmij'),
            !c.done ? h('button', { class: 'btn small ghost', title: 'Strzałka do miejsca, gdzie najłatwiej spotkać tego stwora', onclick: () => Finder.guideMonster(c.monster) }, '🧭 Gdzie?') : null))));
      }
    }
    if (b.stalls && b.stalls.length) {
      parts.push(h('div', { class: 'section-title' }, 'Kramy łowców w pobliżu'));
      parts.push(...b.stalls.map(m => h('div', { class: 'row', style: { padding: '5px 0', borderBottom: '1px solid rgba(59,50,41,.5)' } },
        g('🧺'), h('span', {}, m.name, h('div', { class: 'faint', style: { fontSize: '11px' } }, `${m.owner} · ${m.stock.length} ${plural(m.stock.length, 'towar', 'towary', 'towarów')}`)), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => Market.open(m.id) }, 'Zobacz'))));
    }
    parts.push(h('button', { class: 'btn ghost block', style: { marginTop: '14px' }, onclick: () => Modal.close() }, 'Wyjdź'));
    Modal.open(parts);
  },

  // ----------------------------------------------------------- panele
  openSheet(name) {
    if (Sheet.current === name) return Sheet.close();
    const titles = { bag: 'Torba', recipes: 'Księga receptur', camp: 'Obozowisko', char: 'Postać', journal: 'Kronika' };
    const fn = { bag: b => Bag.render(b), recipes: b => Recipes.render(b), camp: b => this.renderCamp(b), char: b => this.renderChar(b), journal: b => this.renderJournal(b) }[name];
    Sheet.open(name, titles[name], fn);
  },

  renderChar(body) {
    const c = this.state.char;
    body.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { style: { width: '64px' }, html: '<svg viewBox="0 0 100 140" style="width:64px;height:80px"><use href="#hunter"/></svg>' }),
        h('div', {}, h('h3', { style: { fontSize: '24px' } }, c.name), h('div', { class: 'sc muted' }, `Łowca · poziom ${c.level}`),
          h('div', { class: 'muted', style: { fontSize: '13px' } }, `${c.weapon ? `${c.weapon.glyph} ${c.weapon.name} (atak +${c.weapon.attack})` : 'bez broni'} · ${c.armor ? `${c.armor.name} (+${c.armor.armor})` : 'bez pancerza'}`)))));
    body.append(h('div', { class: 'section-title' }, `Cechy${c.stat_points ? ` · ${c.stat_points} pkt do rozdania` : ''}`));
    for (const [k, name] of Object.entries(this.cfg.stat_names)) {
      const base = c.base_stats[k] ?? 0, eff = c.stats[k] ?? base, mod = Math.round((eff - base) * 10) / 10;
      body.append(h('div', { class: 'stat-row' }, h('span', {}, name),
        mod ? h('span', { class: 'mod' + (mod < 0 ? ' neg' : '') }, `${mod > 0 ? '+' : ''}${mod}`) : null,
        h('span', { class: 'v' }, eff),
        c.stat_points ? h('button', { class: 'plus', onclick: () => this.post('/stats/raise', { stat: k }) }, '+') : null));
    }
    body.append(h('p', { class: 'hint' }, 'Siła — obrażenia. Zręczność — celność, kolejność w walce, ucieczka. Witalność — zdrowie. Moc — czary i wigor. Odporność — obrona i tolerancja toksyn. Alchemia — szansa tworzenia. Percepcja — łupy i trafienia krytyczne. Modyfikatory pochodzą z przemian, eliksirów i punktów mocy.'));
    body.append(h('div', { class: 'section-title' }, `Przemiany (${c.mutations.length}/${c.mutation_slots})`));
    if (!c.mutations.length) body.append(h('p', { class: 'muted' }, 'Twoje ciało jest jeszcze ludzkie. Wywary przemiany zmieniają cechy na zawsze — ale mogą zabić.'));
    for (const m of c.mutations) body.append(h('div', { class: 'card' }, h('strong', {}, m.name), h('div', { class: 'muted' }, this.fmtStats(m.stats))));
    body.append(h('div', { class: 'section-title' }, 'Aktywne efekty'));
    if (!c.effects.length) body.append(h('p', { class: 'muted' }, 'Brak.'));
    for (const e of c.effects) body.append(h('div', { class: 'row', style: { padding: '4px 0' } }, h('span', {}, '✧ ' + e.name), h('span', { class: 'muted' }, this.fmtStats(e.stats)), h('span', { class: 'spacer' }), h('span', { class: 'faint' }, fmtTime(e.left))));
    body.append(h('div', { class: 'section-title' }, 'Zlecenia'));
    if (!c.contracts.length) body.append(h('p', { class: 'muted' }, 'Zlecenia przyjmiesz w strażnicy.'));
    for (const ct of c.contracts) {
      body.append(h('div', { class: 'row', style: { padding: '4px 0' } }, h('span', {}, ct.title), h('span', { class: 'spacer' }),
        !ct.done ? h('button', { class: 'btn small ghost', title: 'Prowadź do miejsca, gdzie ten stwór bywa', onclick: () => Finder.guideMonster(ct.monster) }, '🧭 Prowadź') : null,
        h('span', { class: 'chip' }, ct.claimed ? 'rozliczone' : ct.done ? 'do odebrania' : 'w toku')));
    }
    if (!this.isInstalled) {
      body.append(h('div', { class: 'section-title' }, 'Aplikacja'),
        h('div', { class: 'card' }, h('p', { style: { margin: '0 0 8px' } }, 'Zainstaluj grę na telefonie — otworzy się na pełnym ekranie i załaduje od razu, a serwer obudzi się w tle.'),
          h('button', { class: 'btn', onclick: () => this.install() }, '⇩ Zainstaluj aplikację')));
    }
    body.append(h('div', { class: 'ornament' }),
      h('button', { class: 'btn ghost block', onclick: () => this.logout() }, '⏻ Wyloguj'));
  },

  renderCamp(body) {
    const st = this.state;
    const s = st.site;
    const camp = s.my_camp;
    body.append(h('div', { class: 'section-title' }, 'Obóz'));
    if (camp) {
      const d = distM(this.pos[0], this.pos[1], camp.lat, camp.lng);
      body.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', { style: { fontSize: '28px' } }, '🔥'), h('div', {}, h('strong', {}, 'Twój obóz'),
          h('div', { class: 'muted', style: { fontSize: '13px' } }, `Ogień dogaśnie za ${camp.left_h} h · ${Math.round(d)} m stąd`))),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn small primary', onclick: () => this.openSite('camp') }, 'Plan i rozbudowa'),
          h('button', { class: 'btn small', onclick: () => this.post('/camp/feed') }, 'Dorzuć 2 drewna (+6 h)'),
          h('button', { class: 'btn small ghost', onclick: () => { if (!MapView.disabled) MapView.map.setView([camp.lat, camp.lng], 17); Sheet.close(); } }, 'Pokaż na mapie'))));
    } else {
      body.append(h('div', { class: 'card' },
        h('p', { style: { margin: '0 0 8px' } }, 'Obóz widzą wszyscy łowcy — z twoim imieniem. Po 24 h ogień dogasa, a obóz znika. W obozie możesz warzyć wywary i stawiać sprzęt: kocioł, stół zielarza, palenisko.'),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Koszt: 4 × drewno, krzesiwo w torbie.'),
        h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: async () => { const r = await this.post('/camp/build'); if (r) this.loadWorld(); } }, 'Rozbij obóz tutaj')));
    }
    body.append(h('div', { class: 'section-title' }, 'Siedlisko (baza)'));
    const home = st.char.home;
    body.append(h('div', { class: 'card' },
      h('p', { style: { margin: '0 0 8px' } }, home ? 'Twoje siedlisko jest dyskretne: widzisz je tylko ty i ci, których zaprosisz. Sprzęt postawiony tu z czasem niszczeje — naprawiaj go składnikami.' : 'Nie masz jeszcze siedliska. Wybierz miejsce — najlepiej dom.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: async () => { const r = await this.post('/home/set'); if (r) this.loadWorld(); } }, home ? 'Przenieś siedlisko tutaj' : 'Załóż siedlisko tutaj'),
        home ? h('button', { class: 'btn small primary', onclick: () => this.openSite('base') }, 'Plan i rozbudowa') : null,
        home ? h('button', { class: 'btn small ghost', onclick: () => { if (!MapView.disabled) MapView.map.setView(home, 17); Sheet.close(); } }, 'Pokaż na mapie') : null)));
    if (home) {
      const inp = h('input', { placeholder: 'Imię łowcy do zaproszenia' });
      body.append(h('div', { class: 'card' }, h('strong', {}, 'Goście'),
        h('div', { class: 'req' }, s.guests.length ? s.guests.map(gu => h('span', { class: 'chip' }, gu, h('button', { class: 'x', style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bone-dim)' }, onclick: () => this.post('/home/uninvite', { username: gu }) }, '✕'))) : h('span', { class: 'muted' }, 'Nikt nie zna drogi.')),
        h('div', { class: 'row', style: { marginTop: '8px' } }, inp, h('button', { class: 'btn small', onclick: () => this.post('/home/invite', { username: inp.value }) }, 'Zaproś'))));
    }
    Market.campSection(body);
    body.append(h('div', { class: 'section-title' }, 'Sprzęt w zasięgu'));
    if (!st.structures.length) body.append(h('p', { class: 'muted' }, s.in_camp || s.at_base ? 'Nic tu nie stoi. Postaw konstrukcję z torby.' : 'Stań w obozie albo siedlisku, żeby zobaczyć sprzęt.'));
    for (const x of st.structures) {
      const cost = (x.repair_cost || []).map(r => `${this.content.items[r.item]?.name || r.item} ×${r.qty}`).join(', ');
      body.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', { style: { fontSize: '26px' } }, g(x.glyph)), h('div', { style: { flex: 1 } }, h('strong', {}, x.name),
          h('div', { class: 'row', style: { gap: '6px' } }, h('div', { class: 'dur' }, h('i', { style: { width: x.pct + '%' } })), h('span', { class: 'faint', style: { fontSize: '12px' } }, `${x.pct}% · −${x.decay_per_hour}/h`)))),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn small', onclick: () => this.post('/structure/repair', { id: x.id }) }, 'Napraw' + (cost ? ` (${cost})` : '')),
          x.owner_id ? h('button', { class: 'btn small ghost', onclick: () => this.post('/structure/pickup', { id: x.id }) }, 'Zabierz') : null)));
    }
    const placeable = st.inventory.filter(i => i.placeable);
    if (placeable.length) {
      body.append(h('div', { class: 'section-title' }, 'Do postawienia'));
      for (const it of placeable) body.append(h('div', { class: 'row', style: { padding: '5px 0' } }, g(it.glyph), h('span', {}, `${it.name} ×${it.qty}`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', disabled: !s.my_camp, onclick: () => this.place(it.id, 'camp') }, 'W obozie'),
        h('button', { class: 'btn small', disabled: !s.at_own_base, onclick: () => this.place(it.id, 'base') }, 'W siedlisku')));
    }
  },

  renderJournal(body) {
    const j = this.state.journal;
    if (!j.length) body.append(h('p', { class: 'muted' }, 'Kronika jest pusta.'));
    for (const e of j) body.append(h('div', { class: 'jr' }, h('time', {}, fmtDate(e.ts)), e.text));
  },
};

window.addEventListener('DOMContentLoaded', () => Game.boot());
