/* Księga receptur: rozdziały, sortowanie, filtry (można / nie można, z wybranego surowca) i karty receptur.
   RecipeView to wspólny wygląd karty — używa go też okno rozbudowy obozu i okna budynków. */

const RecipeView = {
  /** Szansa po uwzględnieniu zaznaczonych katalizatorów. sel — Set identyfikatorów. */
  chance(r, sel) {
    let bonus = 0;
    for (const c of r.catalysts) if (sel.has(c.item) && c.have) bonus += c.bonus;
    const b = r.breakdown;
    const raw = (b.base || 0) + b.alchemia + b.narzedzia + bonus;
    return { val: Math.max(3, Math.min(97, raw)), bonus };
  },

  defaultSel(r) { return new Set(r.catalysts.filter(c => c.selected).map(c => c.item)); },

  status(r) {
    if (r.can) return h('span', { class: 'rc-ok' }, 'Gotowe do wykonania');
    return h('span', { class: 'rc-miss' }, 'Brakuje: ' + r.missing.slice(0, 3).join(', ') + (r.missing.length > 3 ? '…' : ''));
  },

  /** Nagłówek karty (zawsze widoczny). */
  head(r, sel, { onToggle, open, extra } = {}) {
    const ch = this.chance(r, sel);
    return h('div', { class: 'recipe-head', role: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: onToggle },
      h('span', { class: 'big' }, g(r.result.glyph)),
      h('div', { class: 'rh-text' }, h('h4', {}, r.name + (r.result.qty > 1 ? ` ×${r.result.qty}` : '')),
        h('div', { class: 'muted', style: { fontSize: '12.5px' } }, extra || this.status(r))),
      h('div', { class: 'chance' }, Math.round(ch.val) + '%', h('small', {}, 'szansa')),
      h('span', { class: 'rh-arrow' }, open ? '▾' : '▸'));
  },

  /** Szczegóły: składniki, narzędzia, miejsce, katalizatory, pasek szansy. */
  details(r, sel, repaint, { onIngredient } = {}) {
    const out = [];
    if (r.description) out.push(h('p', { class: 'muted', style: { fontStyle: 'italic', margin: '8px 0 0' } }, r.description));
    out.push(h('div', { class: 'section-title' }, 'Składniki'),
      h('div', { class: 'req' }, r.ingredients.map(i => h('button', {
        class: 'chip req-find ' + (i.have >= i.qty ? 'good' : 'bad'), title: 'Pokaż strzałkę do miejsca, gdzie to zdobyć',
        onclick: () => (onIngredient ? onIngredient(i) : Finder.guide(i.item)),
      }, g(i.glyph), `${i.name} ${i.have}/${i.qty} `, g('🧭')))));
    if (r.tools.length) {
      const where = { any: '', bag: ' (w torbie)', placed: ' (postawione)' }[r.tool_mode] || '';
      out.push(h('div', { class: 'section-title' }, 'Narzędzia' + where),
        h('div', { class: 'req' }, r.tools.map(t => h('button', { class: 'chip req-find ' + (t.source ? 'good' : 'bad'), onclick: () => Finder.guide(t.item) }, g(t.glyph), t.name,
          t.source ? h('small', { class: 'muted' }, ' · ' + ({ bag: 'torba', placed: 'postawione', building: 'warsztat' }[t.source])) : ''))));
    }
    out.push(h('div', { class: 'section-title' }, 'Miejsce'),
      h('div', { class: 'req' }, h('span', { class: 'chip ' + (r.station.ok ? 'good' : 'bad') }, r.station.label)));
    if (r.catalysts.length) {
      out.push(h('div', { class: 'section-title' }, 'Katalizatory i pomoce'));
      const box = h('div', { class: 'req' });
      for (const c of r.catalysts) {
        const on = sel.has(c.item);
        box.append(h('button', {
          class: 'chip cat-toggle ' + (!c.have ? 'off' : on ? 'on' : ''),
          title: c.tool ? 'Pomocnicze narzędzie — działa samo, gdy jest pod ręką' : 'Zużywane przy tworzeniu',
          onclick: () => {
            if (!c.have || c.tool) return;
            on ? sel.delete(c.item) : sel.add(c.item);
            repaint();
          },
        }, g(c.glyph), `${c.name} +${c.bonus}%`, c.tool ? ' ⚒' : '', c.universal ? ' ✦' : ''));
      }
      out.push(box);
    }
    const ch = this.chance(r, sel);
    const b = r.breakdown;
    out.push(h('div', { class: 'chance-bar' }, h('i', { style: { width: ch.val + '%' } })),
      h('div', { class: 'breakdown' }, `baza ${b.base}% + alchemia ${b.alchemia}% + narzędzia ${b.narzedzia}% + katalizatory ${ch.bonus}% = ${Math.round(ch.val)}%`));
    return out;
  },

  /** Cała karta z przyciskiem „Twórz”. opts: open, onToggle, sel, repaint, onCraft, craftLabel, actions */
  card(r, opts) {
    const el = h('div', { class: 'recipe' + (r.can ? ' can' : '') + (opts.open ? ' open' : ''), id: 'rc-' + r.id });
    el.append(this.head(r, opts.sel, { onToggle: opts.onToggle, open: opts.open }));
    if (!opts.open) return el;
    el.append(...this.details(r, opts.sel, opts.repaint, opts));
    el.append(h('div', { class: 'row wrap', style: { marginTop: '10px' } },
      h('span', { class: 'muted', style: { fontSize: '13px' } }, `Wynik: ${r.result.name}`), h('span', { class: 'spacer' }),
      opts.actions || h('button', { class: 'btn primary', disabled: !r.can, onclick: () => opts.onCraft(r, [...opts.sel]) }, opts.craftLabel || 'Twórz')));
    return el;
  },

  /** Wspólne wykonanie receptury z oknem wyniku. Zwraca wynik albo null. */
  async craft(id, catalysts, after) {
    try {
      const r = await API.post('/craft', { recipe: id, catalysts });
      Game.applyState(r.state);
      this.showResult(r.result);
      if (after) after(r.result);
      return r.result;
    } catch (e) { toast(e.message, 'err'); return null; }
  },

  showResult(res, extraTitle) {
    Modal.open([
      h('div', { class: 'event-kicker' }, `Szansa ${res.chance}% · rzut ${res.roll}`),
      h('h2', { class: 'event-title' }, extraTitle || (res.success ? 'Udało się' : 'Porażka')),
      h('p', { class: 'event-text' }, res.text),
      res.messages?.length ? h('ul', { class: 'loot-list' }, res.messages.map(m => h('li', {}, m))) : null,
      h('button', { class: 'btn block', style: { marginTop: '14px' }, onclick: () => Modal.close() }, 'Dalej'),
    ]);
  },
};

const SORTS = {
  ready: { name: 'Gotowe najpierw', fn: (a, b) => (b.can - a.can) || a.name.localeCompare(b.name, 'pl') },
  name: { name: 'Nazwa A–Z', fn: (a, b) => a.name.localeCompare(b.name, 'pl') },
  chance: { name: 'Największa szansa', fn: (a, b) => b.chance - a.chance || a.name.localeCompare(b.name, 'pl') },
  missing: { name: 'Najmniej braków', fn: (a, b) => a.missing.length - b.missing.length || a.name.localeCompare(b.name, 'pl') },
  level: { name: 'Poziom (od najniższego)', fn: (a, b) => (a.min_level || 1) - (b.min_level || 1) || a.name.localeCompare(b.name, 'pl') },
};

const Recipes = {
  list: [],
  openId: null,          // jedna rozwinięta receptura (reszta zwinięta)
  chapter: undefined,    // jeden rozwinięty rozdział (reszta zwinięta)
  group: 'all',          // wybrany rozdział z paska filtrów
  sort: Store.get('navia_rc_sort') || 'ready',
  show: 'all',           // all | can | cannot
  ingredient: '',        // id surowca: tylko receptury, które go używają
  selected: {},
  focus: null,
  query: '',

  sel(r) {
    if (!this.selected[r.id]) this.selected[r.id] = RecipeView.defaultSel(r);
    return this.selected[r.id];
  },

  groups() { return (Game.cfg && Game.cfg.recipe_groups) || []; },

  async render(body) {
    body.append(h('div', { class: 'muted' }, 'Wczytuję księgę…'));
    try { this.list = (await API.get('/recipes')).recipes; } catch (e) { body.innerHTML = ''; return body.append(h('p', {}, e.message)); }
    body.innerHTML = '';
    if (this.focus) {
      const r = this.list.find(x => x.id === this.focus);
      if (r) { this.openId = r.id; this.chapter = r.group; this.group = 'all'; this.query = ''; this.ingredient = ''; this.show = 'all'; }
    }
    const listEl = h('div', { class: 'rc-list' });
    const toolsEl = h('div', {});
    body.append(h('p', { class: 'hint' }, 'Szansę podnoszą: Alchemia, narzędzia (np. alembik, kocioł) i katalizatory. Zaznacz katalizator, by go dodać.'), toolsEl, listEl);
    this.paintTools(toolsEl, listEl);
    this.paint(listEl);
    if (this.focus) {
      const id = 'rc-' + this.focus;
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
      this.focus = null;
    }
  },

  /** Wszystkie surowce występujące w znanych recepturach (do filtra „z surowca”). */
  ingredientOptions() {
    const inv = Object.fromEntries(Game.state.inventory.map(i => [i.id, i.qty]));
    const map = new Map();
    for (const r of this.list) for (const i of r.ingredients) {
      if (!map.has(i.item)) map.set(i.item, { id: i.item, name: i.name, glyph: i.glyph, have: inv[i.item] || 0, n: 0 });
      map.get(i.item).n++;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  },

  paintTools(box, listEl) {
    box.innerHTML = '';
    const rerender = () => { this.paintTools(box, listEl); this.paint(listEl); };
    const search = h('input', { type: 'search', placeholder: 'Szukaj receptury, wyniku albo składnika…', value: this.query });
    search.addEventListener('input', () => { this.query = search.value; this.paint(listEl); });
    const sortSel = h('select', { 'aria-label': 'Sortowanie', onchange: e => { this.sort = e.target.value; Store.set('navia_rc_sort', this.sort); this.paint(listEl); } },
      Object.entries(SORTS).map(([k, v]) => h('option', { value: k, selected: k === this.sort }, v.name)));
    const opts = this.ingredientOptions();
    const ingSel = h('select', { 'aria-label': 'Z surowca', onchange: e => { this.ingredient = e.target.value; rerender(); } },
      h('option', { value: '' }, 'Z dowolnego surowca'),
      h('optgroup', { label: 'Masz w torbie' }, opts.filter(o => o.have).map(o => h('option', { value: o.id, selected: o.id === this.ingredient }, `${o.name} (×${o.have}) · ${o.n} ${plural(o.n, 'receptura', 'receptury', 'receptur')}`))),
      h('optgroup', { label: 'Pozostałe składniki' }, opts.filter(o => !o.have).map(o => h('option', { value: o.id, selected: o.id === this.ingredient }, `${o.name} · ${o.n} ${plural(o.n, 'receptura', 'receptury', 'receptur')}`))));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Pokaż' },
      [['all', 'Wszystkie'], ['can', '✓ Mogę wykonać'], ['cannot', '✕ Nie mogę']].map(([k, n]) =>
        h('button', { class: this.show === k ? 'on' : '', onclick: () => { this.show = k; rerender(); } }, n)));
    box.append(search,
      h('div', { class: 'rc-tools' },
        h('label', { class: 'rc-l' }, 'Sortuj', sortSel),
        h('label', { class: 'rc-l' }, 'Z surowca', ingSel)),
      seg);
    if (this.ingredient) {
      const o = opts.find(x => x.id === this.ingredient);
      box.append(h('div', { class: 'rc-active' }, 'Tylko receptury z: ', h('b', {}, g(o?.glyph), ' ', o?.name || this.ingredient),
        h('button', { class: 'chip', onclick: () => { this.ingredient = ''; rerender(); } }, '✕ wyczyść')));
    }
    const counts = {};
    for (const r of this.filtered(false)) counts[r.group] = (counts[r.group] || 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    box.append(h('div', { class: 'filters rc-groups' },
      h('button', { class: 'chip' + (this.group === 'all' ? ' on' : ''), onclick: () => { this.group = 'all'; rerender(); } }, `Wszystkie ${total}`),
      this.groups().filter(gr => counts[gr.id]).map(gr => h('button', { class: 'chip' + (this.group === gr.id ? ' on' : ''), onclick: () => { this.group = gr.id; this.chapter = gr.id; rerender(); } },
        g(gr.glyph), ` ${gr.name} ${counts[gr.id]}`))));
  },

  /** Receptury po filtrach. withGroup=false pomija wybór rozdziału (do liczników). */
  filtered(withGroup = true) {
    const q = this.query.trim().toLowerCase();
    return this.list.filter(r =>
      (!q || r.name.toLowerCase().includes(q) || r.result.name.toLowerCase().includes(q) || r.ingredients.some(i => i.name.toLowerCase().includes(q))) &&
      (this.show === 'all' || (this.show === 'can' ? r.can : !r.can)) &&
      (!this.ingredient || r.ingredients.some(i => i.item === this.ingredient)) &&
      (!withGroup || this.group === 'all' || r.group === this.group));
  },

  paint(listEl) {
    listEl.innerHTML = '';
    const items = this.filtered().sort(SORTS[this.sort]?.fn || SORTS.ready.fn);
    if (!items.length) {
      listEl.append(h('p', { class: 'muted' }, this.show === 'can' ? 'Teraz nie możesz wykonać żadnej z tych receptur — brakuje składników, narzędzi albo miejsca.' : 'Brak receptur dla tych filtrów.'));
      return;
    }
    const repaint = () => this.paint(listEl);
    const card = r => RecipeView.card(r, {
      open: this.openId === r.id, sel: this.sel(r), repaint,
      onToggle: () => {
        this.openId = this.openId === r.id ? null : r.id;
        repaint();
        if (this.openId) setTimeout(() => document.getElementById('rc-' + r.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
      },
      onCraft: (rr, cats) => RecipeView.craft(rr.id, cats, () => { delete this.selected[rr.id]; if (Sheet.current === 'recipes') Sheet.refresh(); }),
    });
    if (this.group !== 'all') { items.forEach(r => listEl.append(card(r))); return; }
    // Rozdziały: rozwinięty jest tylko jeden.
    const byGroup = {};
    items.forEach(r => (byGroup[r.group] = byGroup[r.group] || []).push(r));
    const present = this.groups().filter(gr => byGroup[gr.id]);
    if (this.chapter === undefined || (this.chapter && !byGroup[this.chapter])) {
      this.chapter = (present.find(gr => byGroup[gr.id].some(r => r.can)) || present[0])?.id || null;
    }
    for (const gr of present) {
      const list = byGroup[gr.id];
      const ready = list.filter(r => r.can).length;
      const open = this.chapter === gr.id;
      listEl.append(h('button', { class: 'rc-chapter' + (open ? ' open' : ''), 'aria-expanded': open ? 'true' : 'false', onclick: () => {
        this.chapter = open ? null : gr.id;
        repaint();
      } },
      h('span', { class: 'bs-arrow' }, open ? '▾' : '▸'), g(gr.glyph), h('span', { class: 'rc-ch-name' }, gr.name),
      h('span', { class: 'rc-ch-count' }, `${list.length}${ready ? ` · ✓ ${ready}` : ''}`)));
      if (open) {
        const wrap = h('div', { class: 'rc-chapter-body' });
        list.forEach(r => wrap.append(card(r)));
        listEl.append(wrap);
      }
    }
  },

  craft(id, catalysts) { return RecipeView.craft(id, catalysts, () => { delete this.selected[id]; if (['recipes', 'bag'].includes(Sheet.current)) Sheet.refresh(); }); },
};
