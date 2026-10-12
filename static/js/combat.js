/* Walka turowa w stylu Pokémonów + auto-walka według planu gracza */
const PLAN_KEY = 'navia_plan';

const CombatPlan = {
  /** Plan auto-walki: lista kroków {t, id, hp_below?} — pierwszy możliwy wygrywa. */
  get() {
    try { const p = JSON.parse(Store.get(PLAN_KEY) || 'null'); if (Array.isArray(p) && p.length) return p; } catch (e) { /* */ }
    return JSON.parse(JSON.stringify(Game.cfg.combat_moves?.default_plan || []));
  },
  save(plan) { Store.set(PLAN_KEY, JSON.stringify(plan)); },
  reset() { Store.del(PLAN_KEY); },

  label(step) {
    const mv = Game.cfg.combat_moves || { attacks: [], spells: [] };
    const special = { '*heal': '❤ Najlepsze leczenie z torby', '*oil': '🛢 Pasujący olej na ostrze', '*throw': '🪨 Najlepszy pocisk do rzutu' };
    if (step.t === 'attack') { const a = mv.attacks.find(x => x.id === step.id); return a ? `${a.glyph} ${a.name}` : step.id; }
    if (step.t === 'spell') { const s = mv.spells.find(x => x.id === step.id); return s ? `${s.glyph} ${s.name}` : step.id; }
    if (step.t === 'flee') return '↯ Ucieczka';
    if (step.t === 'item') return special[step.id] || `${Game.content.items[step.id]?.glyph || '⚱'} ${Game.content.items[step.id]?.name || step.id}`;
    return step.id;
  },

  /** Wszystkie ruchy, które można dodać do planu */
  options() {
    const mv = Game.cfg.combat_moves || { attacks: [], spells: [] };
    const out = [
      ...mv.attacks.map(a => ({ t: 'attack', id: a.id, label: `Atak: ${a.name}` })),
      ...mv.spells.map(s => ({ t: 'spell', id: s.id, label: `Czar: ${s.name}` })),
      { t: 'item', id: '*heal', label: 'Torba: najlepsze leczenie' },
      { t: 'item', id: '*oil', label: 'Torba: pasujący olej' },
      { t: 'item', id: '*throw', label: 'Torba: najlepszy pocisk' },
    ];
    for (const i of Game.state.inventory) {
      if (i.usable || i.effects?.throw || i.effects?.oil) {
        if (!i.effects?.mutation) out.push({ t: 'item', id: i.id, label: `Torba: ${i.name}` });
      }
    }
    out.push({ t: 'flee', id: 'flee', label: 'Ucieczka' });
    return out;
  },

  /** Edytor planu (Modal). onDone — co zrobić po zamknięciu */
  edit(onDone) {
    let plan = this.get();
    const box = h('div', {});
    const paint = () => {
      box.innerHTML = '';
      plan.forEach((st, i) => {
        const hp = h('input', { type: 'number', min: 0, max: 100, placeholder: '—', value: st.hp_below ?? '', style: { width: '62px' },
          title: 'Użyj tylko, gdy twoje zdrowie spadnie poniżej tylu procent',
          oninput: e => { const v = e.target.value; if (v === '') delete st.hp_below; else st.hp_below = Math.max(0, Math.min(100, +v)); } });
        box.append(h('div', { class: 'plan-row' },
          h('span', { class: 'pn' }, String(i + 1)),
          h('span', { class: 'pl' }, this.label(st)),
          h('label', { class: 'faint', style: { fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' } }, 'HP <', hp, '%'),
          h('button', { class: 'btn small ghost', disabled: i === 0, onclick: () => { [plan[i - 1], plan[i]] = [plan[i], plan[i - 1]]; paint(); } }, '▲'),
          h('button', { class: 'btn small ghost', disabled: i === plan.length - 1, onclick: () => { [plan[i + 1], plan[i]] = [plan[i], plan[i + 1]]; paint(); } }, '▼'),
          h('button', { class: 'btn small ghost', onclick: () => { plan.splice(i, 1); paint(); } }, '✕')));
      });
      if (!plan.length) box.append(h('p', { class: 'muted' }, 'Plan jest pusty — auto-walka będzie tylko ciąć.'));
    };
    const opts = this.options();
    const sel = h('select', {}, opts.map((o, i) => h('option', { value: i }, o.label)));
    paint();
    Modal.open([
      h('div', { class: 'event-kicker' }, 'Auto-walka'),
      h('h2', { class: 'event-title' }, 'Plan walki'),
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'W każdej turze sprawdzam kroki od góry i wybieram pierwszy możliwy: ruch nie jest w odnowieniu, przedmiot jest w torbie, a warunek „HP <” (jeśli wpisany) jest spełniony. Gdy nic nie pasuje — Cięcie.'),
      box,
      h('div', { class: 'row', style: { marginTop: '10px' } }, sel,
        h('button', { class: 'btn small', onclick: () => { const o = opts[+sel.value]; plan.push({ t: o.t, id: o.id }); paint(); } }, '+ Dodaj')),
      h('div', { class: 'row wrap', style: { marginTop: '14px' } },
        h('button', { class: 'btn primary', onclick: () => { this.save(plan); Modal.close(); toast('Plan walki zapisany.', 'good'); onDone && onDone(); } }, 'Zapisz plan'),
        h('button', { class: 'btn ghost', onclick: () => { this.reset(); plan = this.get(); paint(); } }, 'Przywróć domyślny'),
        h('button', { class: 'btn ghost', onclick: () => { Modal.close(); onDone && onDone(); } }, 'Anuluj')),
    ]);
  },
};

const Combat = {
  view: null,
  menu: 'main',
  busy: false,
  logLine: null,
  auto: false,       // auto-walka włączona
  fast: false,       // szybsze odtwarzanie (auto-skan)
  onEnd: null,       // wywołanie po zamknięciu podsumowania

  open(view, { auto = false, fast = false, onEnd = null } = {}) {
    this.view = view;
    this.menu = 'main';
    this.busy = false;
    this.summary = null;
    this.auto = auto || Store.get('navia_autofight') === '1';
    this.fast = fast;
    this.onEnd = onEnd;
    $('#combat').classList.remove('hidden');
    this.render();
    const last = (view.log || [])[view.log.length - 1];
    this.say(last ? last.text : `Na drodze staje ${view.name}.`, 'sys', last?.detail);
    if (this.auto) setTimeout(() => this.autoLoop(), this.fast ? 400 : 900);
    return new Promise(rs => { this._resolve = rs; });
  },

  close() {
    $('#combat').classList.add('hidden');
    $('#combat').innerHTML = '';
    this.view = null;
    const r = this._resolve; this._resolve = null;
    const s = this.summary;
    if (r) r(s);
  },

  hpClass(p) { return p < .25 ? 'low' : p < .55 ? 'mid' : ''; },

  status(st, good = false) {
    const names = { bleed: 'krwawienie', poison: 'trucizna', stun: 'ogłuszenie', weaken: 'osłabienie', expose: 'odsłonięty', bound: 'spętany', shield: 'tarcza' };
    return Object.entries(st || {}).map(([k, v]) => `<span class="${k === 'shield' || good ? 'good' : ''}">${names[k] || k}${k === 'shield' ? ' ' + v : v > 1 ? ' ·' + v : ''}</span>`).join('');
  },

  render() {
    const v = this.view;
    const ch = Game.state.char;
    const root = $('#combat');
    root.innerHTML = '';
    const foeP = v.hp / v.max_hp;
    const meP = ch.hp / ch.max_hp;
    const f = v.foe || {}, me = v.me || {};
    const arena = h('div', { class: 'arena' },
      h('div', { class: 'foe-card' },
        h('div', { class: 'fc-name' }, v.name, h('small', {}, 'poz. ' + v.level)),
        h('div', { class: 'hpbar' }, h('i', { id: 'foe-hp', class: this.hpClass(foeP), style: { width: (foeP * 100) + '%' } })),
        h('div', { class: 'hptext', id: 'foe-hpt' }, `${v.hp} / ${v.max_hp}`),
        h('div', { class: 'fc-stats', title: 'atak · obrona (po odsłonięciu/pętach) · szybkość' }, `⚔ ${f.attack ?? '?'} · 🛡 ${f.defense ?? '?'} · ⚡ ${f.speed ?? '?'}`),
        f.weaknesses?.length ? h('div', { class: 'fc-weak' }, 'słabości: ' + f.weaknesses.join(', ')) : null,
        h('div', { class: 'fc-status', html: this.status(v.ms) + (v.oil ? `<span class="good">${esc(v.oil.name)}</span>` : '') })),
      h('div', { class: 'foe-sprite', id: 'foe-sprite' }, g(v.glyph)),
      h('div', { class: 'me-sprite', id: 'me-sprite', html: '<svg viewBox="0 0 100 140"><use href="#hunter"/></svg>' }),
      h('div', { class: 'me-card' },
        h('div', { class: 'fc-name' }, ch.name, h('small', {}, 'poz. ' + ch.level)),
        h('div', { class: 'hpbar' }, h('i', { id: 'me-hp', class: this.hpClass(meP), style: { width: (meP * 100) + '%' } })),
        h('div', { class: 'hptext', id: 'me-hpt' }, `${Math.round(ch.hp)} / ${ch.max_hp}`),
        h('div', { class: 'fc-stats', title: 'siła ciosu · pancerz · szybkość · szansa na krytyk' }, `⚔ ${me.power ?? '?'} · 🛡 ${me.protection ?? '?'} · ⚡ ${me.speed ?? '?'} · ✦ ${me.crit ?? '?'}%`),
        h('div', { class: 'fc-status', html: this.status(v.ps) })),
    );
    this.logLine = h('div', { class: 'combat-log' });
    this.menuEl = h('div', {});
    const top = h('div', { class: 'combat-top' },
      h('span', { class: 'faint' }, `Tura ${v.turn}`),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small ghost', onclick: () => this.showFoe() }, 'ⓘ Wróg'),
      h('button', { class: 'btn small ghost', onclick: () => { this.auto = false; this.paintAuto(); CombatPlan.edit(() => { if (this.view) this.renderMenu(); }); } }, '⚙ Plan'),
      this.autoBtn = h('button', { class: 'btn small auto-toggle', onclick: () => this.toggleAuto() }));
    root.append(arena, h('div', { class: 'combat-box' }, top, this.logLine, this.menuEl));
    this.paintAuto();
    this.renderMenu();
  },

  paintAuto() {
    if (!this.autoBtn) return;
    this.autoBtn.classList.toggle('on', this.auto);
    this.autoBtn.textContent = this.auto ? '❚❚ Auto' : '▶ Auto';
    this.autoBtn.title = this.auto ? 'Zatrzymaj auto-walkę' : 'Walcz automatycznie według planu';
  },

  toggleAuto() {
    this.auto = !this.auto;
    Store.set('navia_autofight', this.auto && !this.fast ? '1' : '0');
    this.paintAuto();
    if (this.auto) this.autoLoop();
  },

  async autoLoop() {
    while (this.auto && this.view && !this.summary) {
      if (this.busy) { await sleep(120); continue; }
      await this.act('auto', CombatPlan.get());
      await sleep(this.fast ? 150 : 350);
    }
  },

  showFoe() {
    const v = this.view, f = v.foe || {};
    Modal.open([
      h('div', { class: 'row' }, h('span', { style: { fontSize: '44px' } }, g(v.glyph)),
        h('div', {}, h('div', { class: 'event-kicker' }, `${v.family} · poziom ${v.level}`), h('h2', { style: { fontSize: '26px' } }, v.name))),
      h('p', { class: 'muted', style: { fontStyle: 'italic' } }, v.description),
      h('div', { class: 'stat-grid' },
        ...[['Zdrowie', `${v.hp}/${v.max_hp}`], ['Atak', f.attack], ['Obrona', f.defense], ['Szybkość', f.speed],
          ['Twoja szybkość', v.me?.speed], ['Szansa ucieczki', (v.me?.flee ?? '?') + '%']].map(([k, x]) => h('div', {}, h('small', {}, k), h('b', {}, String(x ?? '?'))))),
      h('div', { class: 'section-title' }, 'Ruchy wroga'),
      (f.moves || []).map(m => h('div', { class: 'row', style: { padding: '4px 0', borderBottom: '1px solid rgba(59,50,41,.5)' } },
        h('span', {}, m.name), h('span', { class: 'spacer' }),
        h('span', { class: 'faint', style: { fontSize: '13px' } }, `trafia ${m.hit}%${m.dmg ? ` · ${m.dmg[0]}–${m.dmg[1]} obr.` : ''}${m.effect ? ` · ${m.effect}` : ''}`))),
      f.weaknesses?.length ? h('p', {}, 'Słabości: ', h('b', {}, f.weaknesses.join(', '))) : h('p', { class: 'muted' }, 'Słabości nieznane.'),
      h('button', { class: 'btn block', onclick: () => Modal.close() }, 'Zamknij'),
    ]);
  },

  say(text, who = 'sys', detail = null) {
    if (!this.logLine) return;
    this.logLine.innerHTML = `<span class="who-${who}">${esc(text)}</span>${detail ? `<small class="log-detail">${esc(detail)}</small>` : ''}`;
  },

  moveBtn(kind, x) {
    const cls = kind === 'attack' ? 'cm-attack' : 'cm-spell';
    const cd = x.cd_left > 0;
    const stats = [];
    if (x.dmg) stats.push(h('span', { class: 'ms dmg', title: 'przewidywane obrażenia (po pancerzu wroga)' }, `⚔ ${x.dmg[0]}–${x.dmg[1]}`));
    stats.push(h('span', { class: 'ms', title: 'szansa trafienia' }, `🎯 ${x.hit}%`));
    if (x.crit) stats.push(h('span', { class: 'ms', title: 'szansa na krytyk (×1,5)' }, `✦ ${x.crit}%`));
    if (x.first) stats.push(h('span', { class: 'ms', title: 'uderzasz zawsze pierwszy' }, '⇧ pierwszy'));
    stats.push(h('span', { class: 'ms' + (cd ? ' cd' : ''), title: 'odnowienie w turach' }, cd ? `⏳ jeszcze ${x.cd_left}` : x.cd ? `↻ co ${x.cd + 1} tury` : '↻ zawsze'));
    if (x.weak?.length) stats.push(h('span', { class: 'ms weak' }, '★ ' + x.weak.join(', ')));
    return h('button', { class: `btn ${cls} move-btn`, disabled: cd, onclick: () => this.act(kind, x.id) },
      h('span', { class: 'ct' }, h('span', {}, g(x.glyph), ' ', x.name),
        h('span', { class: 'mstats' }, stats),
        h('small', {}, x.effect ? x.effect : x.desc)));
  },

  renderMenu() {
    const m = this.menuEl;
    m.innerHTML = '';
    const v = this.view;
    if (this.summary) return this.renderSummary();
    if (this.menu === 'main') {
      const ready = v.spells.filter(s => !s.cd_left).length;
      m.append(h('div', { class: 'combat-menu' },
        h('button', { class: 'btn cm-attack', onclick: () => { this.menu = 'attack'; this.renderMenu(); } }, '⚔ ', h('span', { class: 'ct' }, 'Atak', h('small', {}, `${v.attacks.filter(a => !a.cd_left).length}/${v.attacks.length} gotowe`))),
        h('button', { class: 'btn cm-spell', onclick: () => { this.menu = 'spell'; this.renderMenu(); } }, '✶ ', h('span', { class: 'ct' }, 'Czary', h('small', {}, `${ready}/${v.spells.length} gotowe`))),
        h('button', { class: 'btn cm-bag', onclick: () => { this.menu = 'item'; this.renderMenu(); } }, '⚱ ', h('span', { class: 'ct' }, 'Torba', h('small', {}, `${v.items.length} do użycia`))),
        h('button', { class: 'btn cm-run', onclick: () => this.act('flee') }, '↯ ', h('span', { class: 'ct' }, 'Ucieczka', h('small', {}, `szansa ${v.me?.flee ?? '?'}%`))),
      ));
      return;
    }
    const list = h('div', { class: 'combat-menu combat-sub' });
    if (this.menu === 'attack') {
      for (const a of v.attacks) list.append(this.moveBtn('attack', a));
    } else if (this.menu === 'spell') {
      for (const s of v.spells) list.append(this.moveBtn('spell', s));
    } else if (this.menu === 'item') {
      if (!v.items.length) list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1', padding: '8px' } }, 'W torbie nie ma nic, co przyda się w walce.'));
      for (const it of v.items) {
        const kind = { rzut: 'rzut', olej: 'olej na ostrze', eliksir: 'eliksir', jedzenie: 'jadło' }[it.kind] || it.kind;
        list.append(h('button', { class: 'btn cm-bag', onclick: () => this.act('item', it.id) },
          g(it.glyph), h('span', { class: 'ct' }, `${it.name} ×${it.qty}`, h('small', {}, kind + (it.info ? ' · ' + it.info : '')))));
      }
    }
    m.append(list, h('button', { class: 'btn ghost small block', style: { marginTop: '8px' }, onclick: () => { this.menu = 'main'; this.renderMenu(); } }, '◂ Wróć'));
  },

  async act(action, arg) {
    if (this.busy || !this.view) return null;
    this.busy = true;
    this.menuEl.style.opacity = '.4';
    let r;
    try {
      r = await API.post('/combat', { action, arg });
    } catch (e) {
      this.busy = false;
      if (this.menuEl) this.menuEl.style.opacity = '1';
      this.say(e.message, 'sys');
      if (this.auto) { this.auto = false; this.paintAuto(); }
      return null;
    }
    const res = r.result;
    Game.applyState(r.state, { silent: true });
    const ch = Game.state.char;
    const pace = this.fast ? 0.45 : 1;
    for (const entry of res.turn_log) {
      this.say(entry.text, entry.who, entry.detail);
      if (entry.who === 'player' && /traci|obrażeń|parzy/.test(entry.text)) {
        this.anim('#foe-sprite', 'shake'); this.anim('#foe-sprite', 'flash');
        this.setFoeHp(res.monster_hp, res.monster_max_hp);
      } else if (entry.who === 'monster' && /tracisz/.test(entry.text)) {
        this.anim('#me-sprite', 'shake');
        this.setMeHp(ch);
      } else if (entry.who === 'sys') {
        this.setFoeHp(res.monster_hp, res.monster_max_hp);
        this.setMeHp(ch);
      }
      const base = entry.who === 'auto' ? 450 : Math.min(1700, 750 + entry.text.length * 12 + (entry.detail ? 350 : 0));
      await sleep(base * pace);
    }
    this.setFoeHp(res.monster_hp, res.monster_max_hp);
    this.setMeHp(ch);
    if (res.combat) {
      this.view = res.combat;
      this.menu = 'main';
      const keep = this.logLine?.innerHTML;
      this.render();
      if (keep && this.auto) this.logLine.innerHTML = keep; else this.say('Co robisz?', 'sys');
    } else if (res.summary) {
      this.summary = res.summary;
      if (res.summary.result === 'win') $('#foe-sprite')?.classList.add('faint-out');
      if (res.summary.result === 'lose') $('#me-sprite')?.classList.add('faint-out');
      this.renderSummary();
    }
    this.busy = false;
    if (this.menuEl) this.menuEl.style.opacity = '1';
    return res;
  },

  anim(sel, cls) {
    const el = $(sel);
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  },

  setFoeHp(hp, max) {
    const p = Math.max(0, hp / max);
    const el = $('#foe-hp');
    if (el) { el.style.width = (p * 100) + '%'; el.className = this.hpClass(p); }
    const t = $('#foe-hpt');
    if (t) t.textContent = `${Math.max(0, hp)} / ${max}`;
  },

  setMeHp(ch) {
    const p = Math.max(0, ch.hp / ch.max_hp);
    const el = $('#me-hp');
    if (el) { el.style.width = (p * 100) + '%'; el.className = this.hpClass(p); }
    const t = $('#me-hpt');
    if (t) t.textContent = `${Math.round(ch.hp)} / ${ch.max_hp}`;
  },

  renderSummary() {
    const s = this.summary;
    const titles = { win: 'Zwycięstwo', lose: 'Porażka', fled: 'Ucieczka' };
    const m = this.menuEl;
    m.innerHTML = '';
    const lines = [];
    if (s.xp) lines.push(`+${s.xp} doświadczenia`);
    if (s.coins) lines.push(`${s.coins > 0 ? '+' : ''}${money(s.coins)}`);
    const mon = this.view?.monster;
    const finish = () => {
      if (s.result === 'win' && typeof Finder !== 'undefined' && Finder.active?.item?.id === 'monster:' + mon) {
        Finder.clear();
        toast('Cel wytropiony — trop zakończony.', 'good');
      }
      this.close(); Game.afterCombat();
    };
    m.append(
      h('h3', { style: { fontSize: '26px', color: s.result === 'win' ? 'var(--gold)' : s.result === 'lose' ? '#e0745f' : 'var(--bone)' } }, titles[s.result] || ''),
      h('ul', { class: 'loot-list' }, [...lines, ...(s.loot || []), ...(s.messages || [])].map(x => h('li', {}, x))),
      h('button', { class: 'btn primary block', style: { marginTop: '12px' }, onclick: finish }, this.fast ? 'Dalej (auto-skan wraca za chwilę)' : 'Wróć na szlak'),
    );
    if (this.fast) setTimeout(() => { if (this.summary === s && this.view !== null) finish(); }, 1800);
  },
};

function sleep(ms) { return new Promise(rs => setTimeout(rs, ms)); }
