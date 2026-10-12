/* Panel admina — konfiguratory treści gry */
const Admin = {
  meta: null,
  table: null,
  rows: [],
  current: null,
  query: '',

  async boot() {
    try {
      this.meta = await API.get('/admin/meta');
    } catch (e) {
      $('#main').innerHTML = '';
      $('#main').append(h('div', { class: 'card', style: { maxWidth: '520px' } },
        h('h2', {}, 'Brak dostępu'),
        h('p', {}, 'Zaloguj się w grze kontem admina. Pierwsze konto założone w grze automatycznie dostaje uprawnienia admina.'),
        h('p', { class: 'muted' }, e.message), h('a', { class: 'btn primary', href: '/' }, 'Do gry')));
      return;
    }
    this.renderNav();
    this.open(location.hash.slice(1) || 'recipes');
    window.addEventListener('hashchange', () => this.open(location.hash.slice(1)));
  },

  renderNav() {
    const nav = $('#nav');
    nav.innerHTML = '';
    nav.append(h('div', { class: 'sep' }, 'TREŚĆ GRY'));
    for (const [t, label] of Object.entries(this.meta.labels)) {
      nav.append(h('button', { 'data-t': t, onclick: () => { location.hash = t; } }, label));
    }
    nav.append(h('div', { class: 'sep' }, 'NARZĘDZIA'));
    for (const [t, label] of [['sim', 'Symulator szans'], ['map', 'Mapa miejsc'], ['users', 'Gracze'], ['io', 'Eksport / import']]) {
      nav.append(h('button', { 'data-t': t, onclick: () => { location.hash = t; } }, label));
    }
  },

  async open(t) {
    if (!t) return;
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    this.table = t;
    this.current = null;
    if (t === 'sim') return this.renderSim();
    if (t === 'map') return this.renderMap();
    if (t === 'users') return this.renderUsers();
    if (t === 'io') return this.renderIO();
    await this.loadRows();
    this.renderTable();
  },

  async loadRows() { this.rows = (await API.get('/admin/table/' + this.table)).rows; },
  async reloadMeta() { this.meta = await API.get('/admin/meta'); },

  opt(name) { return this.meta.options[name] || []; },
  itemName(id) { const i = this.opt('items').find(x => x.id === id); return i ? `${i.glyph} ${i.name}` : id; },

  // ----------------------------------------------------------- lista + edytor
  renderTable() {
    const main = $('#main');
    main.innerHTML = '';
    const label = this.meta.labels[this.table];
    const search = h('input', { placeholder: 'Szukaj…', value: this.query, style: { maxWidth: '260px' } });
    search.addEventListener('input', () => { this.query = search.value; this.paintList(); });
    main.append(h('div', { class: 'adm-head' }, h('h2', {}, label), search,
      h('button', { class: 'btn primary', onclick: () => this.edit(null) }, '+ Nowy')));
    const desc = {
      recipes: 'Konfigurator łączenia przedmiotów. Składniki są zużywane, narzędzia nie. Narzędzia mogą być w torbie albo postawione w obozie/siedlisku (albo dostępne w budynku-warsztacie). Szansę podnoszą Alchemia gracza, premie narzędzi i katalizatory. Katalizator oznaczony jako „narzędzie pomocnicze” nie jest zużywany.',
      events: 'Pula zdarzeń eksploracji. Waga bazowa × mnożnik terenu (najsilniejszy z obecnych) × mnożniki punktów mocy (rosną, im bliżej centrum) × pora dnia × tryb eksploracji. Gra przelicza wagi na procenty. Sprawdź wynik w „Symulatorze szans”.',
      items: 'Opisy słowne przedmiotów i ich działanie. Ikona to dowolne emoji/znak — w grze jest stonowana do sepii.',
      monsters: 'Potwory do walki turowej. Ataki (ruchy) mają moc (mnożnik ataku), celność i efekt.',
      places: 'Miejsca postawione ręcznie albo pobrane z OpenStreetMap. Wygodniej dodawać je na „Mapie miejsc”.',
    }[this.table];
    if (desc) main.append(h('p', { class: 'muted', style: { maxWidth: '900px', marginTop: 0 } }, desc));
    this.listEl = h('div', { class: 'list' });
    this.editorEl = h('div', { class: 'editor' }, h('p', { class: 'muted' }, 'Wybierz rekord z listy albo dodaj nowy.'));
    main.append(h('div', { class: 'split' }, this.listEl, this.editorEl));
    this.paintList();
  },

  rowLabel(r) {
    const t = this.table;
    const glyph = r.glyph || (t === 'recipes' ? (this.opt('items').find(i => i.id === r.result_item)?.glyph || '⚗') : t === 'events' ? { monster: '⚔', item: '❦', story: '✎' }[r.kind] : t === 'terrains' ? '■' : t === 'places' ? { zone: '◯', power: '✶', building: '⌂' }[r.layer] : '•');
    let sub = r.id;
    if (t === 'recipes') sub = `${r.base_chance}% · ${(r.ingredients || []).length} skł. · ${r.station}`;
    if (t === 'events') sub = `${r.kind} · waga ${r.base_weight}${r.enabled ? '' : ' · WYŁ.'}`;
    if (t === 'items') sub = `${r.category} · ${r.rarity}`;
    if (t === 'monsters') sub = `poz. ${r.level} · ${r.family} · HP ${r.hp}`;
    if (t === 'places') sub = `${r.layer}/${r.kind} · ${r.source}`;
    return { glyph, name: r.name || r.id, sub, color: t === 'terrains' ? r.color : null };
  },

  paintList() {
    const q = this.query.toLowerCase();
    this.listEl.innerHTML = '';
    const rows = this.rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    for (const r of rows) {
      const l = this.rowLabel(r);
      this.listEl.append(h('div', { class: 'list-row' + (this.current && this.current.id === r.id ? ' on' : ''), onclick: () => this.edit(r) },
        h('span', { class: 'lg', style: l.color ? { color: l.color } : null }, l.glyph), h('span', { class: 'lt' }, h('b', {}, l.name), h('small', {}, l.sub))));
    }
    if (!rows.length) this.listEl.append(h('p', { class: 'muted', style: { padding: '12px' } }, 'Pusto.'));
  },

  blank() {
    const d = {};
    for (const [f, type] of this.meta.fields[this.table]) {
      d[f] = type.startsWith('itemqty') || ['itemlist', 'catalysts', 'loot', 'moves', 'itemprice', 'recipeprice', 'stringlist', 'actions'].includes(type) || type.startsWith('taglist') ? []
        : type.startsWith('mods') || ['statmods', 'effects', 'outcome'].includes(type) ? {}
          : type === 'bool' ? 1 : type === 'number' || type === 'range' ? 0 : '';
    }
    const defaults = {
      items: { glyph: '•', category: 'inne', rarity: 'pospolity', value: 1, usable: 0, is_tool: 0, placeable: 0 },
      recipes: { base_chance: 60, skill_bonus: 2, result_qty: 1, tool_mode: 'any', station: 'any', min_level: 1, xp: 10, fail_item: '' },
      events: { kind: 'story', base_weight: 5, other_terrain: 1, night_mult: 1, day_mult: 1, min_level: 1, max_level: 99 },
      monsters: { glyph: '☠', family: 'bestia', level: 1, hp: 30, attack: 5, defense: 1, speed: 5, xp: 20, flee_chance: 50 },
      gather_actions: { terrain: 'las', cooldown_s: 30, vigor_cost: 3 },
      terrains: { color: '#556644', weight: 1, min_r: 120, max_r: 360 },
      power_kinds: { glyph: '✶', color: '#8b1e1e', radius: 200, weight: 1 },
      building_types: { glyph: '⌂', weight: 1 },
      places: { layer: 'power', radius: 150, strength: 1, source: 'admin' },
    }[this.table] || {};
    return Object.assign(d, defaults);
  },

  edit(row) {
    this.current = row ? JSON.parse(JSON.stringify(row)) : this.blank();
    this.isNew = !row;
    this.paintList();
    this.renderEditor();
  },

  renderEditor() {
    const r = this.current;
    const ed = this.editorEl;
    ed.innerHTML = '';
    ed.append(h('h3', {}, this.isNew ? 'Nowy rekord' : (r.name || r.id)));
    const grid = h('div', { class: 'fgrid' });
    for (const [f, type, label] of this.meta.fields[this.table]) {
      grid.append(this.field(f, type, label));
    }
    ed.append(grid);
    this.previewEl = h('div', {});
    ed.append(this.previewEl);
    this.updatePreview();
    ed.append(h('div', { class: 'sticky-actions' },
      h('button', { class: 'btn primary', onclick: () => this.save() }, 'Zapisz'),
      !this.isNew ? h('button', { class: 'btn', onclick: () => { this.current = Object.assign(JSON.parse(JSON.stringify(this.current)), { id: this.table === 'places' ? null : this.current.id + '_kopia', name: (this.current.name || '') + ' (kopia)' }); this.isNew = true; this.renderEditor(); } }, 'Duplikuj') : null,
      !this.isNew ? h('button', { class: 'btn ghost', style: { color: '#e0745f' }, onclick: () => this.remove() }, 'Usuń') : null));
  },

  wide: ['textarea', 'itemqty', 'itemlist', 'catalysts', 'loot', 'moves', 'itemprice', 'recipeprice', 'stringlist', 'effects', 'outcome', 'actions', 'statmods'],

  field(f, type, label) {
    const r = this.current;
    const set = v => { r[f] = v; this.updatePreview(); };
    const isWide = this.wide.includes(type) || type.startsWith('mods') || type.startsWith('taglist');
    const wrap = h('div', { class: isWide ? 'wide' : '' }, h('label', {}, label));
    const num = v => (v === '' || v === null || isNaN(+v) ? 0 : +v);
    const itemSelect = (val, onch, optional) => {
      const s = h('select', { onchange: e => onch(e.target.value) });
      if (optional) s.append(h('option', { value: '' }, '— brak —'));
      for (const i of this.opt('items')) s.append(h('option', { value: i.id, selected: i.id === val }, `${i.glyph} ${i.name}`));
      if (val && !this.opt('items').some(i => i.id === val)) s.append(h('option', { value: val, selected: true }, `? ${val}`));
      return s;
    };
    const rowsEditor = (list, makeRow, emptyRow) => {
      const box = h('div', { class: 'rows' });
      const paint = () => {
        box.innerHTML = '';
        list.forEach((it, idx) => box.append(h('div', { class: 'rowed' }, ...makeRow(it, idx, paint),
          h('button', { class: 'del', title: 'Usuń', onclick: () => { list.splice(idx, 1); set(list); paint(); } }, '✕'))));
        box.append(h('button', { class: 'btn small', style: { alignSelf: 'flex-start' }, onclick: () => { list.push(emptyRow()); set(list); paint(); } }, '+ Dodaj'));
      };
      paint();
      return box;
    };

    if (type === 'key') {
      wrap.append(h('input', { value: r[f] ?? '', placeholder: 'np. wywar_kruka (bez spacji)', oninput: e => set(e.target.value.trim()) }));
    } else if (type === 'auto') {
      wrap.append(h('input', { value: r[f] ?? '(nowy)', disabled: true }));
    } else if (type === 'text' || type === 'glyph') {
      const inp = h('input', { value: r[f] ?? '', oninput: e => set(e.target.value) });
      wrap.append(type === 'glyph' ? h('div', { class: 'rowed' }, h('span', { style: { fontSize: '26px', width: '34px' } }, g(r[f])), inp) : inp);
      if (type === 'glyph') inp.addEventListener('input', () => { inp.previousSibling.innerHTML = ''; inp.previousSibling.append(g(inp.value)); });
    } else if (type === 'textarea') {
      wrap.append(h('textarea', { rows: 3, oninput: e => set(e.target.value) }, r[f] ?? ''));
    } else if (type === 'number') {
      wrap.append(h('input', { type: 'number', step: 'any', value: r[f] ?? 0, oninput: e => set(num(e.target.value)) }));
    } else if (type === 'range') {
      const out = h('span', { class: 'sc', style: { width: '50px', textAlign: 'right' } }, (r[f] ?? 0) + '%');
      wrap.append(h('div', { class: 'rowed' }, h('input', { type: 'range', min: 0, max: 100, value: r[f] ?? 0, style: { accentColor: 'var(--blood)', minHeight: '0' }, oninput: e => { set(+e.target.value); out.textContent = e.target.value + '%'; } }), out));
    } else if (type === 'bool') {
      return h('div', { class: 'boolf' }, h('input', { type: 'checkbox', checked: !!r[f], onchange: e => set(e.target.checked ? 1 : 0) }), h('span', {}, label));
    } else if (type === 'color') {
      wrap.append(h('input', { type: 'color', value: r[f] || '#556644', style: { padding: '2px', height: '44px' }, oninput: e => set(e.target.value) }));
    } else if (type.startsWith('select:')) {
      const opts = this.opt(type.split(':')[1]);
      const s = h('select', { onchange: e => { set(e.target.value); if (['kind', 'layer'].includes(f)) this.renderEditor(); } });
      for (const o of opts) s.append(h('option', { value: o, selected: o === r[f] }, o));
      if (r[f] && !opts.includes(r[f])) s.append(h('option', { value: r[f], selected: true }, r[f]));
      wrap.append(s);
    } else if (type === 'item' || type === 'item?') {
      wrap.append(itemSelect(r[f], v => set(v || null), type === 'item?'));
    } else if (type === 'ref') {
      if (r.kind === 'monster') {
        const s = h('select', { onchange: e => set(e.target.value) }, h('option', { value: '' }, '— wybierz —'));
        for (const m of this.opt('monsters')) s.append(h('option', { value: m.id, selected: m.id === r[f] }, `${m.glyph} ${m.name}`));
        wrap.append(s);
      } else if (r.kind === 'item') {
        wrap.append(itemSelect(r[f], v => set(v), true));
      } else {
        wrap.append(h('input', { value: '— nie dotyczy —', disabled: true }));
      }
    } else if (type === 'placekind') {
      const src = { zone: 'terrains', power: 'power_kinds', building: 'building_types' }[r.layer] || 'terrains';
      const s = h('select', { onchange: e => set(e.target.value) }, h('option', { value: '' }, '— wybierz —'));
      for (const o of this.opt(src)) s.append(h('option', { value: o.id, selected: o.id === r[f] }, `${o.glyph || '■'} ${o.name}`));
      wrap.append(s);
    } else if (type === 'itemqty') {
      r[f] = r[f] || [];
      wrap.append(rowsEditor(r[f], it => [itemSelect(it.item, v => { it.item = v; set(r[f]); }),
        h('input', { type: 'number', min: 1, value: it.qty ?? 1, style: { width: '80px' }, oninput: e => { it.qty = Math.max(1, num(e.target.value)); set(r[f]); } })], () => ({ item: this.opt('items')[0]?.id, qty: 1 })));
    } else if (type === 'itemlist') {
      r[f] = r[f] || [];
      const list = r[f];
      const box = h('div', { class: 'rows' });
      const paint = () => {
        box.innerHTML = '';
        list.forEach((id, idx) => box.append(h('div', { class: 'rowed' }, itemSelect(id, v => { list[idx] = v; set(list); }),
          h('button', { class: 'del', onclick: () => { list.splice(idx, 1); set(list); paint(); } }, '✕'))));
        box.append(h('button', { class: 'btn small', style: { alignSelf: 'flex-start' }, onclick: () => { list.push(this.opt('items').find(i => i.category === 'narzedzie' || i.category === 'konstrukcja')?.id); set(list); paint(); } }, '+ Dodaj narzędzie'));
      };
      paint();
      wrap.append(box);
    } else if (type === 'catalysts') {
      r[f] = r[f] || [];
      wrap.append(rowsEditor(r[f], it => [itemSelect(it.item, v => { it.item = v; set(r[f]); }),
        h('input', { type: 'number', value: it.bonus ?? 5, style: { width: '80px' }, title: '+% szansy', oninput: e => { it.bonus = num(e.target.value); set(r[f]); } }),
        h('label', { style: { margin: 0, display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }, title: 'Narzędzie pomocnicze — nie jest zużywane, musi być pod ręką' },
          h('input', { type: 'checkbox', checked: !!it.tool, style: { width: 'auto', minHeight: 0 }, onchange: e => { it.tool = e.target.checked; set(r[f]); } }), 'narzędzie')],
      () => ({ item: this.opt('items')[0]?.id, bonus: 5 })));
      wrap.append(h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '4px' } }, 'Liczba = +% szansy. Przedmioty z polem „katalizator uniwersalny” działają we wszystkich recepturach automatycznie.'));
    } else if (type === 'loot') {
      r[f] = r[f] || [];
      wrap.append(rowsEditor(r[f], it => [itemSelect(it.item, v => { it.item = v; set(r[f]); }),
        h('input', { type: 'number', step: '0.01', min: 0, max: 1, value: it.chance ?? 0.5, style: { width: '80px' }, title: 'szansa 0–1', oninput: e => { it.chance = num(e.target.value); set(r[f]); } }),
        h('input', { type: 'number', min: 1, value: it.min ?? 1, style: { width: '64px' }, title: 'min', oninput: e => { it.min = num(e.target.value); set(r[f]); } }),
        h('input', { type: 'number', min: 1, value: it.max ?? 1, style: { width: '64px' }, title: 'max', oninput: e => { it.max = num(e.target.value); set(r[f]); } })],
      () => ({ item: this.opt('items')[0]?.id, chance: 0.5, min: 1, max: 1 })));
      wrap.append(h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '4px' } }, 'przedmiot · szansa (0–1) · ilość min · max'));
    } else if (type === 'moves') {
      r[f] = r[f] || [];
      const effects = ['', 'bleed', 'poison', 'stun', 'drain', 'weaken'];
      wrap.append(rowsEditor(r[f], it => [
        h('input', { value: it.name || '', placeholder: 'nazwa', oninput: e => { it.name = e.target.value; set(r[f]); } }),
        h('input', { type: 'number', step: '0.1', value: it.power ?? 1, style: { width: '70px' }, title: 'moc (mnożnik ataku)', oninput: e => { it.power = num(e.target.value); set(r[f]); } }),
        h('input', { type: 'number', value: it.acc ?? 90, style: { width: '64px' }, title: 'celność %', oninput: e => { it.acc = num(e.target.value); set(r[f]); } }),
        (() => { const s = h('select', { style: { width: '110px' }, onchange: e => { it.effect = e.target.value || null; set(r[f]); } }); effects.forEach(x => s.append(h('option', { value: x, selected: (it.effect || '') === x }, x || 'bez efektu'))); return s; })(),
        h('input', { value: it.text || '', placeholder: 'opis (opcjonalnie)', oninput: e => { it.text = e.target.value; set(r[f]); } }),
      ], () => ({ name: 'Atak', power: 1, acc: 90 })));
      wrap.append(h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '4px' } }, 'nazwa · moc · celność % · efekt · opis („rzuca się do gardła”)'));
    } else if (type === 'itemprice') {
      r[f] = r[f] || [];
      wrap.append(rowsEditor(r[f], it => [itemSelect(it.item, v => { it.item = v; set(r[f]); }),
        h('input', { type: 'number', value: it.price ?? 5, style: { width: '90px' }, title: 'cena', oninput: e => { it.price = num(e.target.value); set(r[f]); } })], () => ({ item: this.opt('items')[0]?.id, price: 5 })));
    } else if (type === 'recipeprice') {
      r[f] = r[f] || [];
      wrap.append(rowsEditor(r[f], it => [(() => { const s = h('select', { onchange: e => { it.recipe = e.target.value; set(r[f]); } }); this.opt('recipes').forEach(x => s.append(h('option', { value: x.id, selected: x.id === it.recipe }, x.name))); return s; })(),
        h('input', { type: 'number', value: it.price ?? 30, style: { width: '90px' }, oninput: e => { it.price = num(e.target.value); set(r[f]); } })], () => ({ recipe: this.opt('recipes')[0]?.id, price: 30 })));
    } else if (type.startsWith('mods:')) {
      r[f] = r[f] || {};
      const src = this.opt(type.split(':')[1]);
      const box = h('div', { class: 'mods' });
      for (const o of src) {
        box.append(h('label', {}, h('input', { type: 'number', step: '0.1', min: 0, placeholder: '—', value: r[f][o.id] ?? '', oninput: e => { if (e.target.value === '') delete r[f][o.id]; else r[f][o.id] = num(e.target.value); set(r[f]); } }),
          h('span', { style: o.color ? { color: o.color } : null }, `${o.glyph || '■'} `), o.name));
      }
      wrap.append(box, h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '4px' } }, '1 = bez zmian, 3 = trzy razy częściej, 0.2 = rzadko, 0 = nigdy. Puste = nie dotyczy.'));
    } else if (type === 'statmods') {
      r[f] = r[f] || {};
      const box = h('div', { class: 'mods' });
      for (const [k, name] of Object.entries(this.opt('stats'))) {
        box.append(h('label', {}, h('input', { type: 'number', step: '0.5', placeholder: '0', value: r[f][k] ?? '', oninput: e => { if (e.target.value === '' || +e.target.value === 0) delete r[f][k]; else r[f][k] = num(e.target.value); set(r[f]); } }), name));
      }
      wrap.append(box);
    } else if (type === 'stringlist') {
      wrap.append(h('textarea', { rows: 4, oninput: e => set(e.target.value.split('\n').map(s => s.trim()).filter(Boolean)) }, (r[f] || []).join('\n')));
      wrap.append(h('div', { class: 'faint', style: { fontSize: '12px' } }, 'Jedna nazwa w linii. {imie} zostanie zastąpione losowym słowiańskim imieniem.'));
    } else if (type.startsWith('taglist:')) {
      r[f] = r[f] || [];
      const opts = [...new Set([...this.opt(type.split(':')[1]), ...r[f]])];
      const box = h('div', { class: 'checks' });
      for (const o of opts) {
        box.append(h('label', {}, h('input', { type: 'checkbox', checked: r[f].includes(o), onchange: e => { if (e.target.checked) r[f].push(o); else r[f] = r[f].filter(x => x !== o); set(r[f]); } }), this.itemName(o)));
      }
      wrap.append(box);
    } else if (['effects', 'outcome', 'actions'].includes(type)) {
      const ta = h('textarea', { class: 'json', rows: type === 'actions' ? 10 : 6 }, JSON.stringify(r[f] ?? (type === 'actions' ? [] : {}), null, 2));
      const err = h('div', { class: 'err', style: { textAlign: 'left' } });
      ta.addEventListener('input', () => { try { set(JSON.parse(ta.value || (type === 'actions' ? '[]' : '{}'))); err.textContent = ''; } catch (e) { err.textContent = 'Błąd JSON: ' + e.message; } });
      const snips = {
        effects: [['Leczenie', { heal: 40, toxicity: 10 }], ['Efekt czasowy', { toxicity: 20, effect: { name: 'Nazwa efektu', stats: { sila: 3 }, minutes: 30 } }],
          ['Przemiana (mutacja)', { mutation: { name: 'Nazwa przemiany', stats: { sila: 2, odpornosc: -1 } }, toxicity: 60, risk: 0.2 }],
          ['Olej na ostrze', { oil: { family: 'upior', bonus: 0.6 } }], ['Rzut w walce', { throw: { dmg: 12, family: ['upior'], mult: 2, text: 'Rzucasz…' } }],
          ['Broń', { attack: 5, tags: ['srebro'] }], ['Pancerz', { armor: 3 }]],
        outcome: [['Ilość (znalezisko)', { qty: [1, 3] }], ['Proste skutki', { hp: -10, coins: [3, 10], xp: 10, toxicity: 5 }],
          ['Efekt', { effect: { name: 'Błogosławieństwo', stats: { moc: 2 }, minutes: 30 }, xp: 10 }],
          ['Przedmioty', { items: [{ item: 'krwawnik', qty: [1, 2], chance: 1 }] }], ['Potwór na końcu', { monster: 'wilk' }],
          ['Rozgałęzienia', { branches: [{ weight: 2, text: 'Dobre zakończenie…', coins: [5, 10] }, { weight: 1, text: 'Złe zakończenie…', hp: -10 }] }]],
        actions: [['Odpoczynek', { type: 'rest', label: 'Wynajmij izbę', cost: 8 }], ['Sklep', { type: 'shop', label: 'Kup' }], ['Skup', { type: 'sell', label: 'Sprzedaj', rate: 0.5 }],
          ['Nauka receptur', { type: 'learn', label: 'Naucz się' }], ['Oczyszczenie', { type: 'cleanse', label: 'Oczyść', cost: 15 }],
          ['Ofiara / modlitwa', { type: 'pray', label: 'Złóż ofiarę', cost: 10, effect: { name: 'Łaska', stats: { sila: 2 }, minutes: 60 }, text: 'Ofiara przyjęta.' }],
          ['Przeszukanie', { type: 'search', label: 'Przeszukaj', vigor: 8, risk: 0.3, monsters: ['upior'], cooldown: 120, tool: null }],
          ['Plotki', { type: 'rumors', label: 'Posłuchaj plotek' }], ['Bestiariusz', { type: 'bestiary', label: 'Czytaj bestiariusz' }], ['Zlecenia', { type: 'contracts', label: 'Tablica zleceń' }]],
      }[type];
      const sbox = h('div', { class: 'snips' }, h('span', { class: 'faint', style: { fontSize: '12px', alignSelf: 'center' } }, 'Wstaw wzór:'));
      for (const [name, obj] of snips) {
        sbox.append(h('button', { class: 'chip', onclick: () => {
          let cur; try { cur = JSON.parse(ta.value || 'null'); } catch (e) { cur = null; }
          const next = type === 'actions' ? [...(Array.isArray(cur) ? cur : []), obj] : Object.assign({}, cur && typeof cur === 'object' ? cur : {}, obj);
          ta.value = JSON.stringify(next, null, 2); set(next); err.textContent = '';
        } }, name));
      }
      wrap.append(ta, err, sbox);
    }
    return wrap;
  },

  updatePreview() {
    if (!this.previewEl) return;
    const r = this.current;
    this.previewEl.innerHTML = '';
    if (this.table === 'recipes') {
      const alch = 3;
      const cats = (r.catalysts || []).reduce((s, c) => s + (+c.bonus || 0), 0);
      const base = +r.base_chance || 0, sk = alch * (+r.skill_bonus || 0);
      const tools = (r.tools || []).length;
      const res = this.opt('items').find(i => i.id === r.result_item);
      this.previewEl.append(h('div', { class: 'preview' },
        h('strong', {}, 'Podgląd: '), `${(r.ingredients || []).map(i => `${this.itemName(i.item)} ×${i.qty}`).join(' + ') || '…'}`,
        tools ? ` · narzędzia: ${(r.tools || []).map(t => this.itemName(t)).join(', ')}` : '', ` → ${res ? res.glyph + ' ' + res.name : '?'} ×${r.result_qty || 1}`,
        h('div', { class: 'muted', style: { marginTop: '4px' } },
          `Nowy gracz (Alchemia 3): ${Math.max(3, Math.min(97, base + sk))}% · ze wszystkimi katalizatorami: ${Math.max(3, Math.min(97, base + sk + cats))}% (bez premii narzędzi)`)));
    }
    if (this.table === 'events') {
      const ref = r.kind === 'monster' ? this.opt('monsters').find(m => m.id === r.ref) : r.kind === 'item' ? this.opt('items').find(i => i.id === r.ref) : null;
      const tm = Object.entries(r.terrain_mods || {}).map(([k, v]) => `${k}×${v}`).join(', ') || 'brak';
      const pm = Object.entries(r.power_mods || {}).map(([k, v]) => `${k}×${v}`).join(', ') || 'brak';
      this.previewEl.append(h('div', { class: 'preview' }, h('strong', {}, 'Podgląd: '),
        `${r.kind === 'monster' ? 'Walka z: ' : r.kind === 'item' ? 'Znalezisko: ' : 'Zdarzenie fabularne'}${ref ? (ref.glyph + ' ' + ref.name) : ''} · waga ${r.base_weight} · tereny: ${tm} (reszta ×${r.other_terrain}) · punkty mocy: ${pm} · noc ×${r.night_mult} / dzień ×${r.day_mult}`,
        h('div', { class: 'muted', style: { marginTop: '4px' } }, 'Dokładne procenty sprawdzisz w Symulatorze szans (po zapisaniu).')));
    }
  },

  async save() {
    const r = Object.assign({}, this.current);
    if (this.table !== 'places' && !r.id) return toast('Podaj identyfikator.', 'err');
    if (!this.isNew && this.original && this.original !== r.id) r._original_id = this.original;
    try {
      const res = await API.post('/admin/table/' + this.table, r);
      toast('Zapisano.', 'good');
      await this.loadRows();
      await this.reloadMeta();
      const id = res.id;
      this.current = JSON.parse(JSON.stringify(this.rows.find(x => String(x.id) === String(id)) || r));
      this.isNew = false;
      this.paintList();
      this.renderEditor();
    } catch (e) { toast(e.message, 'err'); }
  },

  async remove() {
    if (!confirm(`Usunąć „${this.current.name || this.current.id}”? Tego nie da się cofnąć.`)) return;
    try {
      await API.del(`/admin/table/${this.table}/${encodeURIComponent(this.current.id)}`);
      toast('Usunięto.', 'good');
      await this.loadRows(); await this.reloadMeta();
      this.current = null;
      this.renderTable();
    } catch (e) { toast(e.message, 'err'); }
  },

  // ----------------------------------------------------------- symulator
  sim: { terrains: { las: 1 }, power: {}, night: false, level: 1, mode: 'normalny', percepcja: 5 },

  renderSim() {
    const main = $('#main');
    main.innerHTML = '';
    const s = this.sim;
    main.append(h('div', { class: 'adm-head' }, h('h2', {}, 'Symulator szans eksploracji')),
      h('p', { class: 'muted', style: { maxWidth: '900px', marginTop: 0 } }, 'Ustaw, gdzie stoi gracz: jak mocno działa teren (100% = środek obszaru) i jak blisko jest punktów mocy (100% = w samym centrum). Zobaczysz, z jakim prawdopodobieństwem wylosuje się każde zdarzenie z puli.'));
    const left = h('div', { class: 'editor' });
    const out = h('div', { class: 'editor' });
    const slider = (label, color, val, onch) => {
      const o = h('span', { class: 'sc' }, Math.round(val * 100) + '%');
      return h('div', { class: 'slider-row' }, h('span', { style: color ? { color } : null }, label),
        h('input', { type: 'range', min: 0, max: 100, value: Math.round(val * 100), oninput: e => { o.textContent = e.target.value + '%'; onch(+e.target.value / 100); run(); } }), o);
    };
    left.append(h('div', { class: 'section-title' }, 'Teren'));
    for (const t of this.opt('terrains')) left.append(slider(t.name, t.color, s.terrains[t.id] || 0, v => { if (v) s.terrains[t.id] = v; else delete s.terrains[t.id]; }));
    left.append(h('div', { class: 'section-title' }, 'Punkty mocy'));
    for (const p of this.opt('power_kinds')) left.append(slider(`${p.glyph} ${p.name}`, p.color, s.power[p.id] || 0, v => { if (v) s.power[p.id] = v; else delete s.power[p.id]; }));
    left.append(h('div', { class: 'section-title' }, 'Gracz'));
    const modeSel = h('select', { onchange: e => { s.mode = e.target.value; run(); } });
    for (const [id, m] of Object.entries(this.opt('modes'))) modeSel.append(h('option', { value: id, selected: id === s.mode }, `${m.name} (${m.cost} energii)`));
    left.append(h('label', {}, 'Tryb eksploracji'), modeSel,
      h('label', {}, 'Poziom'), h('input', { type: 'number', min: 1, value: s.level, oninput: e => { s.level = +e.target.value || 1; run(); } }),
      h('label', {}, 'Percepcja'), h('input', { type: 'number', min: 0, value: s.percepcja, oninput: e => { s.percepcja = +e.target.value || 0; run(); } }),
      h('div', { class: 'boolf' }, h('input', { type: 'checkbox', checked: s.night, onchange: e => { s.night = e.target.checked; run(); } }), h('span', {}, 'Noc')));
    main.append(h('div', { class: 'sim-grid' }, left, out));
    let timer;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const r = await API.post('/admin/simulate', s);
          out.innerHTML = '';
          const sums = { monster: 0, item: 0, story: 0 };
          r.probabilities.forEach(p => { sums[p.kind] += p.pct; });
          out.append(h('div', { class: 'row wrap', style: { marginBottom: '10px' } },
            h('span', { class: 'chip', style: { borderColor: 'var(--blood)' } }, `Potwory ${sums.monster.toFixed(1)}%`),
            h('span', { class: 'chip', style: { borderColor: 'var(--gold)' } }, `Znaleziska ${sums.item.toFixed(1)}%`),
            h('span', { class: 'chip', style: { borderColor: 'var(--frost)' } }, `Zdarzenia ${sums.story.toFixed(1)}%`)));
          const max = Math.max(1, ...r.probabilities.map(p => p.pct));
          for (const p of r.probabilities) {
            out.append(h('div', { class: 'omen-row', style: { gridTemplateColumns: '1fr 160px 60px', cursor: 'pointer' }, title: 'Kliknij, by edytować', onclick: () => { location.hash = 'events'; setTimeout(() => { const row = this.rows.find(x => x.id === p.id); if (row) this.edit(row); }, 300); } },
              h('span', {}, `${p.label}`, h('span', { class: 'faint', style: { fontSize: '12px' } }, ` · ${p.name}`)),
              h('div', { class: 'ob' }, h('i', { class: p.kind, style: { width: (100 * p.pct / max) + '%' } })), h('span', { class: 'p' }, p.pct + '%')));
          }
        } catch (e) { toast(e.message, 'err'); }
      }, 150);
    };
    run();
  },

  // ----------------------------------------------------------- mapa miejsc
  async renderMap() {
    const main = $('#main');
    main.innerHTML = '';
    main.append(h('div', { class: 'adm-head' }, h('h2', {}, 'Mapa miejsc')),
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Kliknij mapę, by dodać punkt mocy, obszar terenu albo budynek. Kliknij istniejące miejsce, by je edytować. Półprzezroczyste kółka to świat generowany automatycznie.'),
      h('div', { id: 'amap' }));
    if (!window.L) { $('#amap').innerHTML = '<p class="muted" style="padding:20px">Mapa nie wczytała się (brak internetu).</p>'; return; }
    let center = [50.259, 19.021];
    try { const st = await API.get('/state'); center = [st.state.char.lat, st.state.char.lng]; } catch (e) { /* */ }
    const map = L.map('amap').setView(center, 15);
    try { Admin.tiles = (await API.get('/config')).tiles; } catch (e) { /* */ }
    MapView.addTiles(map);
    const layer = L.layerGroup().addTo(map);
    const colorOf = p => {
      if (p.layer === 'zone') return this.opt('terrains').find(t => t.id === p.kind)?.color || '#556644';
      if (p.layer === 'power') return this.opt('power_kinds').find(t => t.id === p.kind)?.color || '#a3261a';
      return '#c9a24a';
    };
    const draw = async () => {
      layer.clearLayers();
      const c = map.getCenter();
      try {
        const w = await API.get(`/world?lat=${c.lat}&lng=${c.lng}`);
        for (const p of [...w.zones, ...w.power, ...w.buildings]) {
          if (String(p.id).startsWith('p')) continue;
          L.circle([p.lat, p.lng], { radius: p.layer === 'building' ? 25 : p.radius, color: colorOf(p), weight: 1, opacity: .3, fillOpacity: .06, dashArray: '2 6', interactive: false }).addTo(layer);
        }
      } catch (e) { /* */ }
      const rows = (await API.get('/admin/table/places')).rows;
      for (const p of rows) {
        const circ = L.circle([p.lat, p.lng], { radius: p.layer === 'building' ? 30 : p.radius, color: colorOf(p), weight: 2, fillOpacity: .2 }).addTo(layer);
        circ.bindTooltip(`${p.name || p.kind} · ${p.layer}/${p.kind} · ${p.source}`);
        circ.on('click', ev => { L.DomEvent.stopPropagation(ev); form(p); });
      }
    };
    const form = p => {
      const d = Object.assign({ layer: 'power', kind: '', name: '', radius: 150, strength: 1, description: '', source: 'admin' }, p);
      const kindSel = h('select', {});
      const fillKinds = () => {
        kindSel.innerHTML = '';
        const src = { zone: 'terrains', power: 'power_kinds', building: 'building_types' }[d.layer];
        for (const o of this.opt(src)) kindSel.append(h('option', { value: o.id, selected: o.id === d.kind }, `${o.glyph || '■'} ${o.name}`));
      };
      const layerSel = h('select', { onchange: e => { d.layer = e.target.value; fillKinds(); } },
        ['power', 'zone', 'building'].map(l => h('option', { value: l, selected: l === d.layer }, { power: 'Punkt mocy', zone: 'Obszar terenu', building: 'Budynek' }[l])));
      fillKinds();
      const name = h('input', { value: d.name || '' }), rad = h('input', { type: 'number', value: d.radius }), str = h('input', { type: 'number', step: '0.1', value: d.strength }), desc = h('textarea', { rows: 2 }, d.description || '');
      Modal.open([h('h2', { class: 'event-title' }, d.id ? 'Edytuj miejsce' : 'Nowe miejsce'),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `${(+d.lat).toFixed(5)}, ${(+d.lng).toFixed(5)}`),
        h('label', {}, 'Warstwa'), layerSel, h('label', {}, 'Rodzaj'), kindSel, h('label', {}, 'Nazwa'), name,
        h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, h('label', {}, 'Promień (m)'), rad), h('div', { style: { flex: 1 } }, h('label', {}, 'Siła'), str)),
        h('label', {}, 'Opis'), desc,
        h('div', { class: 'row', style: { marginTop: '14px' } },
          h('button', { class: 'btn primary', onclick: async () => {
            try {
              await API.post('/admin/table/places', { id: d.id, layer: d.layer, kind: kindSel.value, name: name.value, lat: d.lat, lng: d.lng, radius: +rad.value, strength: +str.value, description: desc.value, source: d.source || 'admin' });
              Modal.close(); toast('Zapisano.', 'good'); draw();
            } catch (e) { toast(e.message, 'err'); }
          } }, 'Zapisz'),
          d.id ? h('button', { class: 'btn ghost', style: { color: '#e0745f' }, onclick: async () => { await API.del('/admin/table/places/' + d.id); Modal.close(); draw(); } }, 'Usuń') : null,
          h('button', { class: 'btn ghost', onclick: () => Modal.close() }, 'Anuluj'))]);
    };
    map.on('click', e => form({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.on('moveend', () => draw());
    draw();
  },

  // ----------------------------------------------------------- gracze
  async renderUsers() {
    const main = $('#main');
    main.innerHTML = '';
    const { users } = await API.get('/admin/users');
    main.append(h('div', { class: 'adm-head' }, h('h2', {}, 'Gracze')));
    const itemSel = h('select', { style: { maxWidth: '260px' } }, this.opt('items').map(i => h('option', { value: i.id }, `${i.glyph} ${i.name}`)));
    const qty = h('input', { type: 'number', value: 5, style: { width: '80px' } });
    main.append(h('div', { class: 'row wrap', style: { marginBottom: '12px' } }, h('span', { class: 'muted' }, 'Przedmiot do dania:'), itemSel, qty));
    const tbl = h('table', { class: 't' }, h('tr', {}, ['Łowca', 'Poziom', 'Sakiewka', 'Energia', 'Ostatnio', 'Akcje'].map(x => h('th', {}, x))));
    const act = async (id, body) => { try { await API.post('/admin/users/' + id, body); toast('Gotowe.', 'good'); this.renderUsers(); } catch (e) { toast(e.message, 'err'); } };
    for (const u of users) {
      tbl.append(h('tr', {},
        h('td', {}, u.username, u.is_admin ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, 'admin') : null),
        h('td', {}, u.level ?? '—'), h('td', {}, u.coins != null ? money(u.coins) : '—'), h('td', {}, u.energy != null ? Math.floor(u.energy) : '—'),
        h('td', { class: 'muted' }, u.last_seen ? fmtDate(u.last_seen) : '—'),
        h('td', {}, h('div', { class: 'row wrap', style: { gap: '4px' } },
          h('button', { class: 'btn small', onclick: () => act(u.id, { give: { item: itemSel.value, qty: +qty.value || 1 } }) }, 'Daj przedmiot'),
          h('button', { class: 'btn small', onclick: () => act(u.id, { coins: 100 }) }, '+1 dobrota'),
          h('button', { class: 'btn small', onclick: () => act(u.id, { energy: 50 }) }, '+50 energii'),
          h('button', { class: 'btn small', onclick: () => act(u.id, { heal: true }) }, 'Ulecz'),
          h('button', { class: 'btn small', onclick: () => act(u.id, { teach_all: true }) }, 'Wszystkie receptury'),
          h('button', { class: 'btn small ghost', onclick: () => act(u.id, { is_admin: !u.is_admin }) }, u.is_admin ? 'Odbierz admina' : 'Daj admina')))));
    }
    main.append(h('div', { style: { overflowX: 'auto' } }, tbl));
  },

  // ----------------------------------------------------------- eksport / import
  renderIO() {
    const download = async full => {
      const data = await API.get('/admin/export' + (full ? '?full=1' : ''));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `navia-${full ? 'pelna-kopia' : 'tresc'}-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
    };
    const main = $('#main');
    main.innerHTML = '';
    const file = h('input', { type: 'file', accept: 'application/json' });
    main.append(h('div', { class: 'adm-head' }, h('h2', {}, 'Eksport / import treści')),
      h('div', { class: 'card', style: { maxWidth: '640px' } },
        h('p', {}, 'Eksport treści zapisuje przedmioty, receptury, potwory, zdarzenia, tereny, punkty mocy, budynki i miejsca — zrób kopię przed większymi zmianami.'),
        h('p', {}, h('strong', {}, 'Pełna kopia'), ' zawiera dodatkowo konta, postacie, ekwipunek, obozy i siedliska. Darmowa baza na Render wygasa po 30 dniach — pobierz pełną kopię i wgraj ją do nowej bazy, a gracze niczego nie stracą.'),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary', onclick: () => download(false) }, '⇩ Eksport treści'),
          h('button', { class: 'btn', onclick: () => download(true) }, '⇩ Pełna kopia (z graczami)')),
        h('div', { class: 'ornament' }),
        h('p', {}, 'Import dopisuje i nadpisuje rekordy o tych samych identyfikatorach. Pełną kopię wgrywaj do pustej (nowej) bazy.'), file,
        h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: async () => {
          if (!file.files[0]) return toast('Wybierz plik.', 'err');
          try {
            const data = JSON.parse(await file.files[0].text());
            const r = await API.post('/admin/import', data);
            toast(`Zaimportowano ${r.imported} rekordów.`, 'good');
            await this.reloadMeta();
          } catch (e) { toast(e.message, 'err'); }
        } }, '⇧ Importuj')));
  },
};

// zapamiętuj oryginalny identyfikator, by można było go zmienić
const _edit = Admin.edit.bind(Admin);
Admin.edit = function (row) { this.original = row ? row.id : null; _edit(row); };

window.addEventListener('DOMContentLoaded', () => Admin.boot());
