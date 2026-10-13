/* Torba (przeciąganie przedmiotów, dymki craftingu) i księga receptur */
const BAG_GROUPS = [
  { name: 'Surowce', glyph: '🌿', cats: ['ziolo', 'grzyb', 'mineral', 'drewno', 'woda', 'czesc_potwora'] },
  { name: 'Alchemia', glyph: '⚗️', cats: ['eliksir', 'olej', 'wywar', 'katalizator'] },
  { name: 'Wyposażenie', glyph: '⚔', cats: ['bron', 'tarcza', 'rekawice', 'pancerz', 'bizuteria', 'narzedzie'] },
  { name: 'Obozowisko', glyph: '🔥', cats: ['konstrukcja'] },
  { name: 'Prowiant i skarby', glyph: '🍞', cats: ['jedzenie', 'artefakt', 'inne'] },
];

const Bag = {
  filter: 'all',
  combineFrom: null,
  drag: null,
  expanded: null,   // przedmiot rozwinięty w siatce (szczegóły i akcje)

  render(body) {
    const inv = Game.state.inventory;
    const order = Object.keys(CAT_NAMES);
    const rank = c => { const i = order.indexOf(c); return i < 0 ? 999 : i; };
    const cats = [...new Set(inv.map(i => i.category))].sort((a, b) => rank(a) - rank(b));
    body.append(h('p', { class: 'hint' }, 'Dotknij przedmiotu, żeby go rozwinąć i zobaczyć akcje. Przeciągnij przedmiot na inny (na telefonie: przytrzymaj i przeciągnij), żeby sprawdzić, co z nich powstanie.'));
    if (this.expanded && !inv.some(i => i.id === this.expanded)) this.expanded = null;
    if (this.combineFrom) {
      const it = inv.find(i => i.id === this.combineFrom);
      body.append(h('div', { class: 'card row' }, g(it?.glyph), h('span', {}, `Łączysz: ${it?.name}. Wybierz drugi przedmiot.`),
        h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => { this.combineFrom = null; Sheet.refresh(); } }, 'Anuluj')));
    }
    if (this.filter !== 'all' && !cats.includes(this.filter)) this.filter = 'all';
    const f = h('div', { class: 'filters' },
      h('button', { class: 'chip' + (this.filter === 'all' ? ' on' : ''), onclick: () => { this.filter = 'all'; Sheet.refresh(); } }, `Wszystko (${inv.length})`),
      cats.map(c => h('button', { class: 'chip' + (this.filter === c ? ' on' : ''), onclick: () => { this.filter = c; Sheet.refresh(); } },
        `${CAT_NAMES[c] || c} ${inv.filter(i => i.category === c).length}`)));
    body.append(f);
    if (!inv.length) {
      body.append(h('div', { class: 'muted' }, 'Pusto. Idź do lasu, na łąkę albo nad rzekę.'));
      return;
    }
    const slots = list => {
      const grid = h('div', { class: 'inv-grid' });
      for (const it of list.sort((a, b) => a.name.localeCompare(b.name, 'pl'))) {
        const open = this.expanded === it.id;
        const s = h('div', { class: `slot r-${it.rarity}${this.combineFrom === it.id ? ' selected' : ''}${open ? ' expanded' : ''}${it.slot ? ' wearable' : ''}`, 'data-item': it.id, title: it.name },
          h('span', { class: 'n' }, it.name), g(it.glyph), h('span', { class: 'q' }, it.qty));
        this.bindDrag(s, it);
        grid.append(s);
        if (open) grid.append(this.detailPanel(it));
      }
      return grid;
    };
    if (this.filter !== 'all') {
      body.append(slots(inv.filter(i => i.category === this.filter)));
      return;
    }
    // Wszystko: grupy główne → sekcje kategorii
    let closed = {};
    try { closed = JSON.parse(Store.get('navia_bag_closed') || '{}') || {}; } catch (e) { /* */ }
    const used = new Set();
    for (const grp of BAG_GROUPS) {
      const inGroup = cats.filter(c => grp.cats.includes(c));
      inGroup.forEach(c => used.add(c));
      if (!inGroup.length) continue;
      body.append(h('div', { class: 'bag-group' }, g(grp.glyph), ' ', grp.name));
      for (const c of inGroup) this.section(body, c, inv.filter(i => i.category === c), closed, slots);
    }
    const rest = cats.filter(c => !used.has(c));
    if (rest.length) {
      body.append(h('div', { class: 'bag-group' }, g('◇'), ' Pozostałe'));
      for (const c of rest) this.section(body, c, inv.filter(i => i.category === c), closed, slots);
    }
  },

  section(body, cat, list, closed, slots) {
    const total = list.reduce((a, i) => a + i.qty, 0);
    const isClosed = !!closed[cat];
    const head = h('button', { class: 'bag-sec' + (isClosed ? ' closed' : ''), onclick: () => {
      closed[cat] = !closed[cat];
      if (!closed[cat]) delete closed[cat];
      Store.set('navia_bag_closed', JSON.stringify(closed));
      Sheet.refresh();
    } },
    h('span', { class: 'bs-arrow' }, isClosed ? '▸' : '▾'),
    h('span', { class: 'bs-name' }, CAT_NAMES[cat] || cat),
    h('span', { class: 'bs-count' }, `${list.length} ${plural(list.length, 'rodzaj', 'rodzaje', 'rodzajów')} · ${total} szt.`));
    body.append(head);
    if (!isClosed) body.append(slots(list));
  },

  // ----------------------------------------------------------- przeciąganie (mysz + dotyk)
  bindDrag(el, it) {
    const start = (x, y) => { this.drag = { it, el, x, y, active: false, ghost: null, target: null }; };
    const activate = () => {
      const d = this.drag; if (!d || d.active) return;
      d.active = true;
      d.ghost = h('div', { class: 'drag-ghost' }, g(it.glyph));
      document.body.append(d.ghost);
      if (navigator.vibrate) navigator.vibrate(12);
    };
    const move = (x, y) => {
      const d = this.drag; if (!d || !d.active) return;
      d.ghost.style.left = x + 'px'; d.ghost.style.top = y + 'px';
      const under = document.elementFromPoint(x, y)?.closest('.slot');
      $$('.slot.drop-target').forEach(s => s.classList.remove('drop-target'));
      d.target = under && under !== d.el ? under : null;
      if (d.target) d.target.classList.add('drop-target');
    };
    const end = (x, y, tapped) => {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (d.ghost) d.ghost.remove();
      $$('.slot.drop-target').forEach(s => s.classList.remove('drop-target'));
      if (d.active && d.target) this.suggest([d.it.id, d.target.dataset.item], x, y);
      else if (tapped) this.tap(d.it);
    };
    // mysz
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      start(e.clientX, e.clientY);
      const mm = ev => {
        const d = this.drag; if (!d) return;
        if (!d.active && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) activate();
        move(ev.clientX, ev.clientY);
      };
      const mu = ev => {
        document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
        const d = this.drag;
        end(ev.clientX, ev.clientY, d && !d.active);
      };
      document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
    });
    // dotyk: przytrzymanie 280 ms rozpoczyna przeciąganie, krótkie dotknięcie = podgląd
    let timer = null, moved = false;
    el.addEventListener('touchstart', e => {
      const t = e.touches[0]; moved = false;
      start(t.clientX, t.clientY);
      timer = setTimeout(() => { timer = null; activate(); move(t.clientX, t.clientY); }, 280);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      const t = e.touches[0]; const d = this.drag;
      if (d && d.active) { e.preventDefault(); move(t.clientX, t.clientY); return; }
      if (d && Math.hypot(t.clientX - d.x, t.clientY - d.y) > 10) { moved = true; clearTimeout(timer); timer = null; this.drag = null; }
    }, { passive: false });
    el.addEventListener('touchend', e => {
      const t = e.changedTouches[0];
      const wasTap = !!timer && !moved;
      clearTimeout(timer); timer = null;
      if (wasTap) e.preventDefault();
      end(t.clientX, t.clientY, wasTap);
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
  },

  tap(it) {
    if (this.combineFrom && this.combineFrom !== it.id) {
      const a = this.combineFrom; this.combineFrom = null;
      const r = document.querySelector(`.slot[data-item="${CSS.escape(it.id)}"]`)?.getBoundingClientRect();
      this.suggest([a, it.id], r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top : innerHeight / 2);
      Sheet.refresh();
      return;
    }
    this.toggle(it.id);
  },

  toggle(id) {
    this.expanded = this.expanded === id ? null : id;
    Sheet.refresh();
    if (this.expanded) {
      setTimeout(() => $('.slot-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
    }
  },

  /** Otwiera torbę z rozwiniętym przedmiotem (np. z karty postaci). */
  show(id) {
    this.expanded = id; this.filter = 'all';
    const it = Game.state.inventory.find(i => i.id === id);
    if (it) {
      try {
        const closed = JSON.parse(Store.get('navia_bag_closed') || '{}') || {};
        delete closed[it.category]; Store.set('navia_bag_closed', JSON.stringify(closed));
      } catch (e) { /* */ }
    }
    if (Sheet.current === 'bag') Sheet.refresh(); else Game.openSheet('bag');
    setTimeout(() => $('.slot-detail')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  },

  statList(stats) {
    return Object.entries(stats || {}).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${Game.statName(k)}`).join(', ');
  },

  describeEffects(eff) {
    const out = [];
    if (!eff) return out;
    const kinds = (Game.cfg && Game.cfg.weapon_kinds) || {};
    if (eff.heal) out.push(`${eff.heal > 0 ? '+' : ''}${eff.heal} HP`);
    if (eff.vigor) out.push(`+${eff.vigor} wigoru`);
    if (eff.toxicity) out.push(`${eff.toxicity > 0 ? '+' : ''}${eff.toxicity} toksyczności`);
    if (eff.effect) out.push(`${eff.effect.name}: ${Game.fmtStats(eff.effect.stats)} na ${eff.effect.minutes} min`);
    if (eff.mutation) out.push(`Przemiana „${eff.mutation.name}”: ${Game.fmtStats(eff.mutation.stats)} na zawsze · ryzyko ${Math.round((eff.risk || 0) * 100)}%`);
    if (eff.oil) out.push(`Olej: +${Math.round(eff.oil.bonus * 100)}% obrażeń przeciw: ${eff.oil.family}`);
    if (eff.throw) out.push(`W walce można rzucić (${eff.throw.dmg} obr., silniej na: ${(eff.throw.family || []).join(', ') || 'wszystko'})`);
    if (eff.attack) out.push(`Atak +${eff.attack}${eff.kind ? ` · ${kinds[eff.kind] || eff.kind}` : ''}${eff.two_handed ? ' · dwuręczna' : ''}${(eff.tags || []).length ? ' · ' + eff.tags.join(', ') : ''}`);
    if (eff.armor) out.push(`Pancerz +${String(eff.armor).replace('.', ',')}`);
    if (eff.stats && Object.keys(eff.stats).length) out.push(`Gdy założone: ${this.statList(eff.stats)}`);
    if (eff.weapon_mods) out.push('Broń w tej ręce: ' + this.weaponMods(eff.weapon_mods));
    return out;
  },

  weaponMods(m) {
    const kinds = (Game.cfg && Game.cfg.weapon_kinds) || {};
    const p = [];
    if (m.attack_pct) p.push(`${m.attack_pct > 0 ? '+' : ''}${m.attack_pct}% ataku`);
    if (m.attack) p.push(`${m.attack > 0 ? '+' : ''}${m.attack} ataku`);
    if (m.crit) p.push(`+${m.crit}% krytyka`);
    if ((m.tags || []).length) p.push(`działa jak: ${m.tags.join(', ')}`);
    const k = (m.kinds || []).length ? ` (tylko: ${m.kinds.map(x => kinds[x] || x).join(', ')})` : ' (każda broń)';
    return (p.join(', ') || 'bez zmian') + k;
  },

  /** Sloty, na które da się założyć przedmiot: [{slot, name, item}] */
  slotsFor(it) {
    if (!it.slot) return [];
    const eq = Game.state.char.equipment.slots;
    const two = it.effects?.two_handed;
    const pref = { shield: ['hand_l', 'hand_r'] }[it.slot] || [];
    const rank = s => (s.item ? 10 : 0) + (pref.indexOf(s.slot) >= 0 ? pref.indexOf(s.slot) : 5);
    return eq.filter(s => s.accepts.includes(it.slot) && (!two || s.slot === 'hand_r')).sort((a, b) => rank(a) - rank(b));
  },

  async equip(id, slot) {
    const r = await Game.post('/equip', { item: id, slot }, true);
    if (r && this.expanded === id && !Game.state.inventory.some(i => i.id === id)) this.expanded = null;
    if (Sheet.current) Sheet.refresh();
    return r;
  },

  /** Przyciski „Załóż” / „Podmień” dla przedmiotu do ubrania. */
  equipButtons(it, { small } = {}) {
    const slots = this.slotsFor(it);
    const cls = 'btn' + (small ? ' small' : '');
    const out = [];
    const many = slots.length > 1;
    for (const s of slots) {
      const where = many ? ` · ${s.name.toLowerCase()}` : '';
      if (s.item) out.push(h('button', { class: cls, title: `Zdejmiesz: ${s.item.name}`, onclick: () => this.equip(it.id, s.slot) }, `⇄ Podmień${where}`, h('small', { class: 'muted' }, ` (${s.item.name})`)));
      else out.push(h('button', { class: cls + ' primary', onclick: () => this.equip(it.id, s.slot) }, `Załóż${where}`));
    }
    return out;
  },

  /** Porównanie z tym, co jest teraz założone. */
  compare(it) {
    const slots = this.slotsFor(it).filter(s => s.item);
    if (!slots.length) return null;
    const e = it.effects || {};
    const rows = slots.map(s => {
      const o = s.item.effects || {};
      const d = [];
      const diff = (a, b, label) => { const x = Math.round(((a || 0) - (b || 0)) * 10) / 10; if (x) d.push(h('span', { class: 'bb-stat ' + (x > 0 ? 'up' : 'down') }, `${x > 0 ? '+' : ''}${String(x).replace('.', ',')} ${label}`)); };
      diff(e.attack, o.attack, 'ataku'); diff(e.armor, o.armor, 'pancerza');
      const keys = new Set([...Object.keys(e.stats || {}), ...Object.keys(o.stats || {})]);
      keys.forEach(k => diff((e.stats || {})[k], (o.stats || {})[k], Game.statName(k)));
      diff((e.weapon_mods || {}).attack_pct, (o.weapon_mods || {}).attack_pct, '% ataku broni');
      return h('div', { class: 'cmp-row' }, h('span', { class: 'faint' }, `zamiast ${s.item.glyph} ${s.item.name} (${s.name.toLowerCase()}): `),
        d.length ? h('span', { class: 'bb-stats', style: { display: 'inline-flex' } }, d) : h('span', { class: 'faint' }, 'bez różnicy w liczbach'));
    });
    return h('div', { class: 'cmp' }, rows);
  },

  /** Rozwinięty przedmiot — panel w siatce torby z akcjami (zamiast okna modalnego). */
  detailPanel(it) {
    const st = Game.state;
    const effs = this.describeEffects(it.effects);
    if (it.tool_bonus) effs.push(`Narzędzie: +${it.tool_bonus}% do szansy wytworzenia`);
    if (it.catalyst_bonus) effs.push(`Katalizator: +${it.catalyst_bonus}% do każdej receptury`);
    if (it.uses) effs.push(`Postawiony w obozie ma ${it.uses} ${plural(it.uses, 'akcję', 'akcje', 'akcji')} użycia.`);
    const slotName = it.slot ? ((Game.cfg.slot_types || {})[it.slot] || it.slot) : null;
    const acts = h('div', { class: 'sd-actions' });
    if (it.slot) acts.append(...this.equipButtons(it));
    if (it.usable) acts.append(h('button', { class: 'btn primary', onclick: () => Game.useItem(it.id) }, ['eliksir', 'wywar'].includes(it.category) ? 'Wypij' : 'Użyj'));
    if (it.placeable) {
      acts.append(h('button', { class: 'btn', disabled: !st.site.my_camp, title: st.site.my_camp ? '' : 'Najpierw rozbij obóz', onclick: () => Game.place(it.id, 'camp') }, 'Postaw w obozie'));
      acts.append(h('button', { class: 'btn', disabled: !st.site.at_own_base, title: st.site.at_own_base ? '' : 'Stań w swoim siedlisku', onclick: () => Game.place(it.id, 'base') }, 'Postaw w siedlisku'));
    }
    acts.append(h('button', { class: 'btn', onclick: () => this.suggest([it.id], innerWidth / 2, innerHeight / 3) }, it.is_tool ? 'Użyj narzędzia' : 'Receptury z tym'));
    acts.append(h('button', { class: 'btn', onclick: () => { Recipes.ingredient = it.id; Recipes.group = 'all'; Recipes.chapter = undefined; Recipes.show = 'all'; Recipes.query = ''; Game.openSheet('recipes'); } }, '📖 W księdze'));
    acts.append(h('button', { class: 'btn', onclick: () => { this.expanded = null; this.combineFrom = it.id; Sheet.refresh(); } }, 'Połącz z…'));
    acts.append(h('button', { class: 'btn', onclick: () => Finder.search(it.id) }, '🧭 Gdzie zdobyć?'));
    acts.append(h('button', { class: 'btn ghost', onclick: () => Game.drop(it.id) }, 'Wyrzuć 1'));
    return h('div', { class: `slot-detail r-${it.rarity}` },
      h('div', { class: 'sd-head' },
        h('div', { class: 'sd-glyph' }, g(it.glyph)),
        h('div', { class: 'sd-titles' },
          h('div', { class: 'event-kicker' }, `${CAT_NAMES[it.category] || it.category} · ${it.rarity}${slotName ? ' · zakłada się: ' + slotName.toLowerCase() : ''}`),
          h('h3', {}, it.name), h('div', { class: 'muted sc', style: { fontSize: '13px' } }, `×${it.qty} · wartość ${money(it.value)}`)),
        h('button', { class: 'x sd-close', 'aria-label': 'Zwiń', onclick: () => this.toggle(it.id) }, '✕')),
      h('p', { class: 'sd-desc' }, it.description),
      effs.length ? h('ul', { class: 'loot-list' }, effs.map(e => h('li', {}, e))) : null,
      this.compare(it),
      acts);
  },

  // ----------------------------------------------------------- dymek z propozycjami
  closeBubble() { $('.bubble')?.remove(); },

  async suggest(ids, x, y) {
    this.closeBubble();
    let data;
    try { data = await API.post('/craft/suggest', { items: ids }); } catch (e) { return toast(e.message, 'err'); }
    const inv = Game.state.inventory;
    const names = ids.map(i => inv.find(x => x.id === i)).filter(Boolean).map(i => `${i.glyph} ${i.name}`);
    const b = h('div', { class: 'bubble' });
    b.append(h('div', { class: 'row' }, h('h4', {}, names.join(' + ')), h('span', { class: 'spacer' }),
      h('button', { class: 'x round', style: { width: '32px', height: '32px', fontSize: '14px' }, onclick: () => this.closeBubble() }, '✕')));
    if (!data.recipes.length) {
      b.append(h('p', { class: 'muted' }, data.unknown ? 'Czujesz, że to do siebie pasuje… ale nie znasz receptury. Poszukaj jej w bibliotece, klasztorze albo u zielarki.' : 'Nic z tego nie będzie.'));
    } else if (data.unknown) {
      b.append(h('p', { class: 'hint' }, `+ ${data.unknown} nieznanych receptur z tymi składnikami.`));
    }
    for (const r of data.recipes) {
      b.append(h('div', { class: 'recipe' + (r.can ? ' can' : ''), style: { marginTop: '8px' } },
        h('div', { class: 'recipe-head' }, h('span', { class: 'big' }, g(r.result.glyph)),
          h('div', {}, h('h4', {}, r.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, r.can ? 'Masz wszystko' : 'Brakuje: ' + r.missing.join(', '))),
          h('div', { class: 'chance' }, Math.round(r.chance) + '%', h('small', {}, 'szansa'))),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn small primary', disabled: !r.can, onclick: () => { this.closeBubble(); Recipes.craft(r.id, []); } }, 'Twórz'),
          h('button', { class: 'btn small', onclick: () => { this.closeBubble(); Recipes.focus = r.id; Game.openSheet('recipes'); } }, 'Szczegóły i katalizatory'))));
    }
    document.body.append(b);
    const w = b.offsetWidth, hh = b.offsetHeight;
    b.style.left = Math.max(10, Math.min(innerWidth - w - 10, x - w / 2)) + 'px';
    b.style.top = Math.max(20, Math.min(innerHeight - hh - 10, y + 24)) + 'px';
  },
};

