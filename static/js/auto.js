/* Auto-skan: samoczynna eksploracja okolicy (farmienie) z auto-walką i auto-zbieractwem */
const AUTO_KEY = 'navia_autoscan';

const AutoScan = {
  running: false,
  stats: null,
  cfg: null,

  defaults() { return { hp: 40, reserve: 0, max: 0, fight: true, gather: true, flee_strong: false }; },
  load() {
    let c = {};
    try { c = JSON.parse(Store.get(AUTO_KEY) || '{}') || {}; } catch (e) { /* */ }
    this.cfg = { ...this.defaults(), ...c };
    return this.cfg;
  },
  save() { Store.set(AUTO_KEY, JSON.stringify(this.cfg)); },

  /** Okno ustawień i start */
  open() {
    if (this.running) return this.stop('Zatrzymano.');
    const c = this.load();
    const mode = Game.state.energy_modes[Game.mode] || {};
    const num = (key, min, max, label, hint) => h('label', { class: 'auto-field' }, h('span', {}, label, hint ? h('small', {}, hint) : null),
      h('input', { type: 'number', min, max, value: c[key], oninput: e => { c[key] = Math.max(min, Math.min(max, +e.target.value || 0)); } }));
    const chk = (key, label, hint) => h('label', { class: 'auto-field chk' },
      h('input', { type: 'checkbox', checked: !!c[key], onchange: e => { c[key] = e.target.checked; } }), h('span', {}, label, hint ? h('small', {}, hint) : null));
    Modal.open([
      h('div', { class: 'event-kicker' }, `Tryb ${mode.name || ''} · ${mode.cost || '?'} energii za skan`),
      h('h2', { class: 'event-title' }, 'Auto-skan okolicy'),
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Łowca sam przeczesuje teren w wybranym trybie — co kilka sekund eksploruje, zbiera, co rośnie pod nogami, a potwory bije według twojego planu walki. Zatrzyma się, gdy zabraknie energii albo zdrowie spadnie zbyt nisko.'),
      num('hp', 5, 95, 'Przerwij przy zdrowiu poniżej (%)'),
      num('reserve', 0, 100, 'Zostaw w zapasie energii', 'np. na powrót do domu'),
      num('max', 0, 500, 'Najwyżej tyle skanów', '0 = do wyczerpania energii'),
      chk('fight', 'Walcz automatycznie', 'według planu walki; wyłączone = auto-skan zatrzyma się przy potworze'),
      chk('flee_strong', 'Uciekaj przed silniejszymi', 'gdy potwór ma wyższy poziom niż ty'),
      chk('gather', 'Zbieraj po drodze', 'drewno, zioła i inne — gdy masz narzędzie i wigor'),
      h('div', { class: 'row wrap', style: { marginTop: '14px' } },
        h('button', { class: 'btn primary', onclick: () => { this.save(); Modal.close(); this.start(); } }, '▶ Rozpocznij'),
        h('button', { class: 'btn', onclick: () => { this.save(); CombatPlan.edit(() => this.open()); } }, '⚙ Plan walki'),
        h('button', { class: 'btn ghost', onclick: () => Modal.close() }, 'Anuluj')),
    ]);
  },

  async start() {
    if (this.running) return;
    this.load();
    this.running = true;
    this.stats = { n: 0, fights: 0, wins: 0, loot: {}, coins: 0, xp: 0, last: '' };
    document.body.classList.add('autoscan');
    this.bar();
    try { this.lock = await navigator.wakeLock?.request('screen'); } catch (e) { /* ekran może zgasnąć */ }
    this.loop();
  },

  stop(reason) {
    if (!this.running) return;
    this.running = false;
    document.body.classList.remove('autoscan');
    try { this.lock?.release(); } catch (e) { /* */ }
    this.lock = null;
    $('#auto-bar')?.remove();
    Game.renderModes();
    const s = this.stats;
    const loot = Object.entries(s.loot).map(([k, v]) => `${k} ×${v}`);
    Modal.open([
      h('div', { class: 'event-kicker' }, 'Auto-skan zakończony'),
      h('h2', { class: 'event-title' }, reason || 'Koniec'),
      h('div', { class: 'stat-grid' },
        h('div', {}, h('small', {}, 'Skanów'), h('b', {}, String(s.n))),
        h('div', {}, h('small', {}, 'Walk'), h('b', {}, `${s.wins}/${s.fights}`)),
        h('div', {}, h('small', {}, 'Doświadczenie'), h('b', {}, '+' + s.xp)),
        h('div', {}, h('small', {}, 'Monety'), h('b', {}, money(s.coins)))),
      loot.length ? h('ul', { class: 'loot-list' }, loot.map(x => h('li', {}, x))) : h('p', { class: 'muted' }, 'Bez łupów.'),
      h('button', { class: 'btn block', style: { marginTop: '12px' }, onclick: () => Modal.close() }, 'Dalej'),
    ]);
  },

  bar() {
    let el = $('#auto-bar');
    if (!this.running) return;
    if (!el) {
      el = h('div', { id: 'auto-bar' });
      document.body.append(el);
    }
    const s = this.stats;
    el.innerHTML = '';
    el.append(h('span', { class: 'ab-spin' }, '⟳'),
      h('span', { class: 'ab-t' }, h('b', {}, `Auto-skan · ${s.n}${this.cfg.max ? '/' + this.cfg.max : ''}`),
        h('small', {}, s.last || 'przeczesuję okolicę…')),
      h('button', { class: 'btn small', onclick: () => this.stop('Zatrzymano.') }, '■ Stop'));
  },

  addLoot(lines) {
    for (const x of lines || []) {
      const m = /^(.+?) ×(\d+)$/.exec(x);
      if (m) this.stats.loot[m[1]] = (this.stats.loot[m[1]] || 0) + (+m[2]);
    }
  },

  async loop() {
    const cd = Math.max(1, Game.cfg.explore_cooldown || 8) * 1000;
    while (this.running) {
      const st = Game.state, ch = st.char;
      const mode = st.energy_modes[Game.mode];
      if (Combat.view) { await sleep(500); continue; }
      if (100 * ch.hp / ch.max_hp < this.cfg.hp) { this.stop(`Zdrowie spadło poniżej ${this.cfg.hp}% — odpocznij.`); break; }
      if (this.cfg.max && this.stats.n >= this.cfg.max) { this.stop(`Wykonano ${this.stats.n} skanów.`); break; }
      // zbieractwo po drodze
      if (this.cfg.gather) {
        for (const gth of st.gathers) {
          if (!this.running) break;
          if (gth.has_tool && gth.cooldown_left <= 0 && Game.state.char.vigor >= gth.vigor) {
            try {
              const r = await API.post('/gather', { id: gth.id });
              Game.applyState(r.state, { silent: true, noCombat: true });
              this.addLoot(r.result.loot);
              this.stats.last = `${gth.name}: ${(r.result.loot || []).join(', ') || 'nic'}`;
              this.bar();
              await sleep(600);
            } catch (e) { /* cooldown albo brak sił — pomijamy */ }
          }
        }
      }
      if (!this.running) break;
      if (Game.state.char.energy - mode.cost < this.cfg.reserve) { this.stop('Skończyła się energia.'); break; }
      let r;
      try {
        r = await API.post('/explore', { mode: Game.mode });
      } catch (e) {
        const m = /odczekaj (\d+)/i.exec(e.message);
        if (m) { await sleep((+m[1]) * 1000 + 200); continue; }
        this.stop(e.message); break;
      }
      this.stats.n++;
      Game.applyState(r.state, { silent: true, noCombat: true });
      const res = r.result;
      this.addLoot(res.messages);
      this.stats.last = `${res.event.name}${res.messages.length ? ': ' + res.messages.join(', ') : ''}`;
      this.bar();
      if (res.combat) {
        this.stats.fights++;
        if (!this.cfg.fight) { this.stop(`Na drodze stoi ${res.combat.name} — walcz sam.`); Modal.close(); Combat.open(Game.state.combat); break; }
        const strong = this.cfg.flee_strong && res.combat.level > Game.state.char.level;
        const summary = await this.fight(strong);
        if (summary) {
          if (summary.result === 'win') this.stats.wins++;
          this.stats.xp += summary.xp || 0;
          this.stats.coins += summary.coins || 0;
          this.addLoot(summary.loot);
          this.stats.last = `${res.combat.name}: ${{ win: 'zwycięstwo', lose: 'porażka', fled: 'ucieczka' }[summary.result] || ''}`;
          this.bar();
          if (summary.result === 'lose') { this.stop(`Pokonał cię ${res.combat.name}.`); break; }
        }
      } else {
        toast(`${res.event.name}${res.messages.length ? ' — ' + res.messages.join(', ') : ''}`, res.messages.length ? 'good' : '');
      }
      await sleep(cd + 300);
    }
  },

  /** Jedna walka w trybie auto (z podglądem). Zwraca podsumowanie. */
  async fight(fleeFirst) {
    if (fleeFirst) {
      // próby ucieczki, a gdy się nie uda — walka według planu
      const plan = [{ t: 'flee', id: 'flee' }];
      const p = Combat.open(Game.state.combat, { fast: true });
      Combat.auto = false; Combat.paintAuto();
      for (let i = 0; i < 3 && Combat.view && !Combat.summary; i++) await Combat.act('auto', plan);
      if (Combat.view && !Combat.summary) { Combat.auto = true; Combat.paintAuto(); Combat.autoLoop(); }
      return p;
    }
    return Combat.open(Game.state.combat, { auto: true, fast: true });
  },
};
