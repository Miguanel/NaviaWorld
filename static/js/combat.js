/* Walka turowa w stylu Pokémonów */
const Combat = {
  view: null,
  menu: 'main',
  busy: false,
  logLine: null,

  open(view) {
    this.view = view;
    this.menu = 'main';
    this.busy = false;
    this.summary = null;
    $('#combat').classList.remove('hidden');
    this.render();
    const last = (view.log || [])[view.log.length - 1];
    this.say(last ? last.text : `Na drodze staje ${view.name}.`, 'sys');
  },

  close() {
    $('#combat').classList.add('hidden');
    $('#combat').innerHTML = '';
    this.view = null;
  },

  hpClass(p) { return p < .25 ? 'low' : p < .55 ? 'mid' : ''; },

  status(st, good = false) {
    const names = { bleed: 'krwawienie', poison: 'trucizna', stun: 'ogłuszenie', weaken: 'osłabienie', expose: 'odsłonięty', bound: 'spętany', shield: 'tarcza' };
    return Object.keys(st || {}).map(k => `<span class="${k === 'shield' || good ? 'good' : ''}">${names[k] || k}</span>`).join('');
  },

  render() {
    const v = this.view;
    const ch = Game.state.char;
    const root = $('#combat');
    root.innerHTML = '';
    const foeP = v.hp / v.max_hp;
    const meP = ch.hp / ch.max_hp;
    const ps = Object.assign({}, v.ps || {});
    const arena = h('div', { class: 'arena' },
      h('div', { class: 'foe-card' },
        h('div', { class: 'fc-name' }, v.name, h('small', {}, 'poz. ' + v.level)),
        h('div', { class: 'hpbar' }, h('i', { id: 'foe-hp', class: this.hpClass(foeP), style: { width: (foeP * 100) + '%' } })),
        h('div', { class: 'hptext', id: 'foe-hpt' }, `${v.hp} / ${v.max_hp}`),
        h('div', { class: 'fc-status', html: this.status(v.ms) + (v.oil ? `<span class="good">${esc(v.oil.name)}</span>` : '') })),
      h('div', { class: 'foe-sprite', id: 'foe-sprite' }, g(v.glyph)),
      h('div', { class: 'me-sprite', id: 'me-sprite', html: '<svg viewBox="0 0 100 140"><use href="#hunter"/></svg>' }),
      h('div', { class: 'me-card' },
        h('div', { class: 'fc-name' }, ch.name, h('small', {}, 'poz. ' + ch.level)),
        h('div', { class: 'hpbar' }, h('i', { id: 'me-hp', class: this.hpClass(meP), style: { width: (meP * 100) + '%' } })),
        h('div', { class: 'hptext', id: 'me-hpt' }, `${Math.round(ch.hp)} / ${ch.max_hp} · wigor ${Math.round(ch.vigor)}`),
        h('div', { class: 'fc-status', html: this.status(ps) })),
    );
    this.logLine = h('div', { class: 'combat-log' });
    this.menuEl = h('div', {});
    root.append(arena, h('div', { class: 'combat-box' }, this.logLine, this.menuEl));
    this.renderMenu();
  },

  say(text, who = 'sys') {
    if (!this.logLine) return;
    this.logLine.innerHTML = `<span class="who-${who}">${esc(text)}</span>`;
  },

  renderMenu() {
    const m = this.menuEl;
    m.innerHTML = '';
    const v = this.view;
    const ch = Game.state.char;
    if (this.summary) return this.renderSummary();
    if (this.menu === 'main') {
      m.append(h('div', { class: 'combat-menu' },
        h('button', { class: 'btn cm-attack', onclick: () => { this.menu = 'attack'; this.renderMenu(); } }, '⚔ ', h('span', { class: 'ct' }, 'Atak', h('small', {}, 'ciosy bronią'))),
        h('button', { class: 'btn cm-spell', onclick: () => { this.menu = 'spell'; this.renderMenu(); } }, '✶ ', h('span', { class: 'ct' }, 'Czary', h('small', {}, `wigor ${Math.round(ch.vigor)}/${ch.max_vigor}`))),
        h('button', { class: 'btn cm-bag', onclick: () => { this.menu = 'item'; this.renderMenu(); } }, '⚱ ', h('span', { class: 'ct' }, 'Torba', h('small', {}, `${v.items.length} do użycia`))),
        h('button', { class: 'btn cm-run', onclick: () => this.act('flee') }, '↯ ', h('span', { class: 'ct' }, 'Ucieczka', h('small', {}, 'w krzaki'))),
      ));
      return;
    }
    const list = h('div', { class: 'combat-menu combat-sub' });
    if (this.menu === 'attack') {
      for (const a of v.attacks) {
        list.append(h('button', { class: 'btn cm-attack', disabled: ch.vigor < a.vigor, onclick: () => this.act('attack', a.id) },
          h('span', { class: 'ct' }, a.name, h('small', {}, `${a.desc}${a.vigor ? ` · ${a.vigor} wig.` : ''}`))));
      }
    } else if (this.menu === 'spell') {
      for (const s of v.spells) {
        list.append(h('button', { class: 'btn cm-spell', disabled: ch.vigor < s.vigor, onclick: () => this.act('spell', s.id) },
          h('span', { class: 'ct' }, s.name, h('small', {}, `${s.desc} · ${s.vigor} wig.`))));
      }
    } else if (this.menu === 'item') {
      if (!v.items.length) list.append(h('div', { class: 'muted', style: { gridColumn: '1/-1', padding: '8px' } }, 'W torbie nie ma nic, co przyda się w walce.'));
      for (const it of v.items) {
        const kind = { rzut: 'rzut', olej: 'olej na ostrze', eliksir: 'eliksir', jedzenie: 'jadło' }[it.kind] || it.kind;
        list.append(h('button', { class: 'btn cm-bag', onclick: () => this.act('item', it.id) },
          g(it.glyph), h('span', { class: 'ct' }, `${it.name} ×${it.qty}`, h('small', {}, kind))));
      }
    }
    m.append(list, h('button', { class: 'btn ghost small block', style: { marginTop: '8px' }, onclick: () => { this.menu = 'main'; this.renderMenu(); } }, '◂ Wróć'));
  },

  async act(action, arg) {
    if (this.busy) return;
    this.busy = true;
    this.menuEl.style.opacity = '.4';
    let r;
    try {
      r = await API.post('/combat', { action, arg });
    } catch (e) {
      this.busy = false;
      this.menuEl.style.opacity = '1';
      this.say(e.message, 'sys');
      return;
    }
    const res = r.result;
    const prevChar = Game.state.char;
    Game.applyState(r.state, { silent: true });
    const ch = Game.state.char;
    for (const entry of res.turn_log) {
      this.say(entry.text, entry.who);
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
      await new Promise(rs => setTimeout(rs, Math.min(1500, 650 + entry.text.length * 12)));
    }
    this.setFoeHp(res.monster_hp, res.monster_max_hp);
    this.setMeHp(ch);
    if (res.combat) {
      this.view = res.combat;
      this.menu = 'main';
      this.render();
      this.say('Co robisz?', 'sys');
    } else if (res.summary) {
      this.summary = res.summary;
      if (res.summary.result === 'win') $('#foe-sprite')?.classList.add('faint-out');
      if (res.summary.result === 'lose') $('#me-sprite')?.classList.add('faint-out');
      this.renderSummary();
    }
    this.busy = false;
    this.menuEl.style.opacity = '1';
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
    if (t) t.textContent = `${Math.round(ch.hp)} / ${ch.max_hp} · wigor ${Math.round(ch.vigor)}`;
  },

  renderSummary() {
    const s = this.summary;
    const titles = { win: 'Zwycięstwo', lose: 'Porażka', fled: 'Ucieczka' };
    const m = this.menuEl;
    m.innerHTML = '';
    const lines = [];
    if (s.xp) lines.push(`+${s.xp} doświadczenia`);
    if (s.coins) lines.push(`${s.coins > 0 ? '+' : ''}${money(s.coins)}`);
    m.append(
      h('h3', { style: { fontSize: '26px', color: s.result === 'win' ? 'var(--gold)' : s.result === 'lose' ? '#e0745f' : 'var(--bone)' } }, titles[s.result] || ''),
      h('ul', { class: 'loot-list' }, [...lines, ...(s.loot || []), ...(s.messages || [])].map(x => h('li', {}, x))),
      h('button', { class: 'btn primary block', style: { marginTop: '12px' }, onclick: () => { this.close(); Game.afterCombat(); } }, 'Wróć na szlak'),
    );
  },
};
