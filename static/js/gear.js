/* Karta postaci: strój na „lalce”. Każda ręka ma własną rękawicę i własną broń —
   rękawica zmienia statystyki broni trzymanej w tej samej ręce. */
const SLOT_ICONS = {
  head: '⛑️', neck: '📿', cloak: '🧥', chest: '🦺', belt: '🎗️', legs: '👖', feet: '🥾',
  glove_r: '🧤', glove_l: '🧤', hand_r: '🗡️', hand_l: '🛡️', ring_r: '💍', ring_l: '💍',
};
// Lalka patrzy na ciebie: jej prawa ręka jest po twojej lewej stronie.
const DOLL = [
  ['cloak', 'head', 'neck'],
  ['glove_r', 'chest', 'glove_l'],
  ['hand_r', 'belt', 'hand_l'],
  ['ring_r', 'legs', 'ring_l'],
  [null, 'feet', null],
];

const fmtN = v => String(Math.round(v * 10) / 10).replace('.', ',');

const Gear = {
  open: null,   // rozwinięty slot (jeden naraz)

  render(body) {
    const eq = Game.state.char.equipment;
    const bySlot = Object.fromEntries(eq.slots.map(s => [s.slot, s]));
    const doll = h('div', { class: 'doll' }, h('div', { class: 'doll-figure', html: '<svg viewBox="0 0 100 140"><use href="#hunter"/></svg>' }));
    DOLL.forEach((row, ri) => row.forEach((k, ci) => {
      if (!k) return;
      const box = this.slotBox(bySlot[k]);
      box.style.gridRow = String(ri + 1);
      box.style.gridColumn = String(ci + 1);
      doll.append(box);
    }));
    body.append(h('div', { class: 'section-title' }, 'Strój i oręż'),
      h('div', { class: 'doll-sides' }, h('span', {}, '◂ prawa ręka'), h('span', {}, 'lewa ręka ▸')),
      doll);
    if (this.open && bySlot[this.open]) body.append(this.detail(bySlot[this.open], eq.gear));
    body.append(this.summary(eq.gear));
  },

  slotBox(s) {
    const it = s.item;
    const open = this.open === s.slot;
    return h('button', {
      class: 'eq-slot' + (it ? ` filled r-${it.rarity}` : '') + (open ? ' open' : '') + (s.blocked ? ' blocked' : ''),
      title: s.name + (it ? `: ${it.name}` : ''), 'aria-expanded': open ? 'true' : 'false',
      onclick: () => {
        this.open = open ? null : s.slot;
        Sheet.refresh();
        if (this.open) setTimeout(() => $('.eq-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
      },
    },
    h('span', { class: 'eq-g' }, it ? g(it.glyph) : s.blocked ? g('🔗') : g(SLOT_ICONS[s.slot], 'eq-empty')),
    h('span', { class: 'eq-name' }, it ? it.name : s.blocked ? 'broń dwuręczna' : '—'),
    h('span', { class: 'eq-label' }, s.name));
  },

  handFor(gear, slot) {
    if (gear.two_handed && ['hand_r', 'hand_l', 'glove_r', 'glove_l'].includes(slot)) return gear.hands[0];
    const side = slot.endsWith('_r') ? 'right' : slot.endsWith('_l') ? 'left' : null;
    return side ? gear.hands.find(x => x.side === side) : null;
  },

  handLine(hd) {
    const what = hd.item ? `${hd.item.name} (${hd.kind_name})` : 'pięść';
    const mods = [];
    if (hd.flat) mods.push(`${hd.flat > 0 ? '+' : ''}${fmtN(hd.flat)}`);
    if (hd.pct) mods.push(`${hd.pct > 0 ? '+' : ''}${fmtN(hd.pct)}%`);
    if (hd.crit) mods.push(`krytyk +${fmtN(hd.crit)}%`);
    const side = { right: 'Prawa ręka', left: 'Lewa ręka', both: 'Obie ręce' }[hd.side];
    return h('div', { class: 'hand-line' },
      h('div', {}, h('b', {}, side), ': ', what, ' — atak ', h('b', {}, fmtN(hd.base)),
        mods.length ? [' → ', h('b', { class: 'up' }, fmtN(hd.attack)), h('span', { class: 'faint' }, ` (${mods.join(', ')})`)] : null,
        hd.share === 0.5 && hd.attack > 0 ? h('span', { class: 'faint' }, ' · druga ręka liczy się w połowie') : null),
      hd.gloves.map(gl => h('div', { class: 'faint', style: { fontSize: '12.5px', paddingLeft: '10px' } },
        gl.applies ? `✓ ${gl.name} wzmacnia tę broń` : `✕ ${gl.name} — ${gl.why}`)));
  },

  detail(s, gear) {
    const it = s.item;
    const box = h('div', { class: 'eq-detail' });
    box.append(h('div', { class: 'row' }, h('div', { class: 'event-kicker' }, s.name), h('span', { class: 'spacer' }),
      h('button', { class: 'x sd-close', 'aria-label': 'Zwiń', onclick: () => { this.open = null; Sheet.refresh(); } }, '✕')));
    if (s.blocked) box.append(h('p', { class: 'muted' }, 'Prawa ręka trzyma broń dwuręczną — lewa jest zajęta. Załóż tu coś, a broń dwuręczna wróci do torby.'));
    if (it) {
      const effs = Bag.describeEffects(it.effects);
      box.append(h('div', { class: 'sd-head', style: { marginTop: '6px' } },
        h('div', { class: 'sd-glyph' }, g(it.glyph)),
        h('div', { class: 'sd-titles' }, h('h3', {}, it.name), h('div', { class: 'muted sc', style: { fontSize: '12px' } }, `${CAT_NAMES[it.category] || it.category} · ${it.rarity}`))),
      h('p', { class: 'sd-desc' }, it.description),
      effs.length ? h('ul', { class: 'loot-list' }, effs.map(e => h('li', {}, e))) : null);
    } else if (!s.blocked) {
      box.append(h('p', { class: 'muted', style: { margin: '6px 0' } }, 'Pusto.'));
    }
    const hd = this.handFor(gear, s.slot);
    if (hd) box.append(this.handLine(hd));
    if (it) box.append(h('div', { class: 'sd-actions' }, h('button', { class: 'btn', onclick: () => Game.post('/unequip', { slot: s.slot }) }, 'Zdejmij do torby')));
    // Co z torby tu pasuje
    const fits = Game.state.inventory.filter(i => Bag.slotsFor(i).some(x => x.slot === s.slot));
    box.append(h('div', { class: 'section-title' }, `Z torby (${fits.length})`));
    if (!fits.length) {
      box.append(h('p', { class: 'muted', style: { margin: '0 0 6px' } }, 'Nic z torby tu nie pasuje.'),
        h('button', { class: 'btn small', onclick: () => { Recipes.group = ['hand_r', 'hand_l'].includes(s.slot) ? 'orez' : 'stroj'; Recipes.chapter = Recipes.group; Recipes.ingredient = ''; Recipes.show = 'all'; Game.openSheet('recipes'); } }, '📖 Receptury: ' + (['hand_r', 'hand_l'].includes(s.slot) ? 'oręż i tarcze' : 'odzienie')));
    }
    for (const f of fits) {
      const eff = Bag.describeEffects(f.effects);
      box.append(h('div', { class: 'fit-row' },
        h('span', { class: 'fg' }, g(f.glyph)),
        h('div', { class: 'fit-main' }, h('strong', {}, f.name, f.qty > 1 ? h('span', { class: 'faint' }, ` ×${f.qty}`) : null),
          h('div', { class: 'faint', style: { fontSize: '12.5px' } }, eff.join(' · ') || f.description)),
        h('button', { class: 'btn small' + (it ? '' : ' primary'), onclick: () => Bag.equip(f.id, s.slot) }, it ? '⇄ Podmień' : 'Załóż')));
    }
    return box;
  },

  summary(gear) {
    const c = Game.state.char;
    const st = c.stats;
    const total = gear.attack + (st.sila || 0) * 1.5 + c.level;
    const prot = gear.armor + (st.odpornosc || 0) * 0.5;
    const gs = Object.entries(gear.stats || {}).filter(([, v]) => v);
    return h('div', { class: 'card gear-sum' },
      h('div', { class: 'gs-grid' },
        h('div', {}, h('small', {}, 'Siła ciosu'), h('b', {}, fmtN(total)), h('span', { class: 'faint' }, `broń ${fmtN(gear.attack)} + siła×1,5 + poziom`)),
        h('div', {}, h('small', {}, 'Ochrona'), h('b', {}, fmtN(prot)), h('span', { class: 'faint' }, `pancerz ${fmtN(gear.armor)} + odporność×0,5`)),
        h('div', {}, h('small', {}, 'Krytyk z oręża'), h('b', {}, `+${fmtN(gear.crit)}%`), h('span', { class: 'faint' }, gear.tags.length ? 'działa jak: ' + gear.tags.join(', ') : 'rękawice i broń'))),
      h('div', { style: { marginTop: '8px' } }, gear.hands.map(hd => this.handLine(hd))),
      gs.length ? h('div', { class: 'bb-stats', style: { marginTop: '8px' } }, h('span', { class: 'faint', style: { fontSize: '12px' } }, 'Strój zmienia cechy: '),
        gs.map(([k, v]) => Game.statChip(k, v))) : null);
  },
};
