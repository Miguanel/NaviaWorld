/* Tropiciel (strzałki do surowców) i kramy kupców */
const LEAD_TYPES = {
  gather: 'Zbieractwo', explore: 'Eksploracja', hunt: 'Polowanie', shop: 'Sklep',
  market: 'Targowisko', stall: 'Kram łowcy', search: 'Przeszukiwanie',
};

const Finder = {
  active: null,      // { item, leads, res }
  query: '',

  restore() {
    try {
      const saved = JSON.parse(Store.get('navia_trail') || 'null');
      if (saved && saved.item) this.setTrail(saved.res, saved.leads, false);
    } catch (e) { /* */ }
  },

  /** Okno „Czego szukasz?” z listą wszystkich przedmiotów */
  open() {
    const items = Object.values(Game.content.items).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    const have = new Set(Game.state.inventory.map(i => i.id));
    const input = h('input', { placeholder: 'np. krwawnik, srebro, oko nocnicy…', value: this.query });
    const list = h('div', { class: 'find-list' });
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      this.query = input.value;
      list.innerHTML = '';
      const shown = items.filter(i => !q || i.name.toLowerCase().includes(q) || (CAT_NAMES[i.category] || '').toLowerCase().includes(q)).slice(0, 60);
      for (const it of shown) {
        list.append(h('div', { class: 'find-item', onclick: () => this.search(it.id) },
          h('span', { style: { fontSize: '22px', width: '30px', textAlign: 'center' } }, g(it.glyph)),
          h('span', { style: { flex: 1 } }, it.name, h('div', { class: 'faint', style: { fontSize: '12px' } }, CAT_NAMES[it.category] || it.category)),
          have.has(it.id) ? h('span', { class: 'chip' }, 'masz') : null));
      }
      if (!shown.length) list.append(h('p', { class: 'muted' }, 'Nic takiego nie znam.'));
    };
    input.addEventListener('input', paint);
    Modal.open([
      h('div', { class: 'event-kicker' }, 'Tropiciel'),
      h('h2', { class: 'event-title' }, 'Czego szukasz?'),
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Wybierz towar — na mapie pojawią się strzałki: gdzie go zebrać, wytropić, wyeksplorować albo kupić.'),
      input, list,
      this.active ? h('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => { this.clear(); Modal.close(); } }, `Zakończ obecny trop (${this.active.item.name})`) : null,
    ]);
    paint();
    setTimeout(() => input.focus(), 50);
  },

  async search(itemId) {
    let res;
    try { res = await API.get('/find?item=' + encodeURIComponent(itemId)); } catch (e) { return toast(e.message, 'err'); }
    this.showLeads(res);
  },

  showLeads(res) {
    const pos = Game.pos;
    const leads = res.leads.map(l => ({ ...l, itemName: res.item.name }));
    const rows = leads.map((l, i) => {
      const d = distM(pos[0], pos[1], l.lat, l.lng);
      const color = MapView.TRAIL_COLORS[l.type] || '#c9a24a';
      return h('div', { class: 'lead' },
        h('span', { class: 'lg' }, g(l.glyph || '◆')),
        h('span', { class: 'lt' },
          h('b', {}, h('span', { class: 'lead-dot', style: { background: color } }), l.title),
          h('small', {}, l.detail + (l.pct != null ? ` · szansa tam ~${l.pct}%` : '') + (l.night ? ' · częściej nocą' : '') + (l.day_only ? ' · tylko za dnia' : '')),
          h('div', { class: 'faint', style: { fontSize: '12px' } }, `${LEAD_TYPES[l.type] || ''}${l.place ? ' · ' + l.place : ''}`)),
        h('span', { class: 'ld' }, d < 30 ? 'tutaj' : fmtDist(d), h('br'),
          h('button', { class: 'btn small', style: { marginTop: '4px' }, onclick: () => { this.setTrail(res, [leads[i]]); Modal.close(); } }, 'Prowadź')));
    });
    Modal.open([
      h('div', { class: 'row' }, h('span', { style: { fontSize: '44px' } }, g(res.item.glyph)),
        h('div', {}, h('div', { class: 'event-kicker' }, 'Tropy'), h('h2', { style: { fontSize: '27px' } }, res.item.name))),
      h('p', { class: 'muted', style: { fontStyle: 'italic' } }, res.item.description),
      leads.length ? rows : h('p', {}, 'W promieniu kilku kilometrów nie ma śladu tego towaru. Spróbuj w innej okolicy albo zapytaj na targowisku.'),
      res.recipes.length ? h('div', { class: 'card', style: { marginTop: '12px' } }, h('strong', {}, 'Możesz to też wytworzyć: '),
        res.recipes.map(r => h('button', { class: 'chip', style: { margin: '4px' }, onclick: () => { Modal.close(); Recipes.focus = r.id; Game.openSheet('recipes'); } }, r.name))) : null,
      h('div', { class: 'row wrap', style: { marginTop: '14px' } },
        leads.length ? h('button', { class: 'btn primary', onclick: () => { this.setTrail(res, leads); Modal.close(); } }, `Pokaż wszystkie strzałki (${leads.length})`) : null,
        h('button', { class: 'btn ghost', onclick: () => this.open() }, 'Szukaj czego innego')),
    ]);
  },

  setTrail(res, leads, fit = true) {
    this.active = { item: res.item, leads, res };
    leads.forEach(l => { l.arrived = false; });
    Store.set('navia_trail', JSON.stringify({ item: res.item.id, res, leads }));
    MapView.setTrail(leads);
    Game.renderCtx();
    if (fit && !MapView.disabled && leads.length) {
      const pts = [Game.pos, ...leads.map(l => [l.lat, l.lng])];
      MapView.follow = false;
      MapView.map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 17 });
    }
    toast(`Trop: ${res.item.name}. Idź za strzałką — dotknij jej, żeby zobaczyć dokąd prowadzi.`, 'good');
  },

  clear() {
    this.active = null;
    Store.del('navia_trail');
    MapView.setTrail(null);
    Game.renderCtx();
  },

  nearest() {
    if (!this.active || !Game.pos) return null;
    let best = null;
    for (const l of this.active.leads) {
      const d = distM(Game.pos[0], Game.pos[1], l.lat, l.lng);
      if (!best || d < best.d) best = { l, d };
    }
    return best;
  },

  /** Po każdym kroku: czy dotarliśmy do celu */
  check() {
    if (!this.active) return;
    for (const l of this.active.leads) {
      const d = distM(Game.pos[0], Game.pos[1], l.lat, l.lng);
      if (d < 30 && !l.arrived) {
        l.arrived = true;
        const what = { gather: 'Zbieraj tutaj', explore: 'Eksploruj tutaj', hunt: 'Eksploruj tutaj — tu poluje się na ten łup', search: 'Przeszukaj budynek', shop: 'Wejdź do budynku', market: 'Wejdź na targowisko', stall: 'Otwórz kram' }[l.type] || '';
        toast(`Jesteś na miejscu: ${l.title}. ${what}.`, 'good');
      }
    }
  },
};

/* ----------------------------------------------------------------- Kramy kupców (graczy) */
const Market = {
  async open(id) {
    try { this.render(await API.get('/merchant/' + id)); } catch (e) { toast(e.message, 'err'); }
  },

  async op(id, op, body) {
    try {
      const r = await API.post(`/merchant/${id}/${op}`, body || {});
      Game.applyState(r.state, { silent: true });
      toastAll(r.result.messages, 'good');
      if (op === 'close') { Modal.close(); Game.loadWorld(); return; }
      const m = r.result.merchant;
      m.dist = distM(Game.pos[0], Game.pos[1], m.lat, m.lng);
      this.render(m);
    } catch (e) { toast(e.message, 'err'); }
  },

  render(m) {
    const ch = Game.state.char;
    const far = (m.dist ?? 0) > Game.cfg.interact_radius;
    const parts = [
      h('div', { class: 'row' }, h('span', { style: { fontSize: '44px' } }, g('🧺')),
        h('div', {}, h('div', { class: 'event-kicker' }, m.own ? 'Twój kram' : `Kram łowcy ${m.owner}`), h('h2', { style: { fontSize: '26px' } }, m.name))),
      h('p', { class: 'muted' }, m.active ? `Kupiec zostanie jeszcze ${m.left_h} h.` : 'Kupiec odszedł — kram jest zamknięty.',
        far ? ` Jesteś ${fmtDist(m.dist)} stąd — podejdź bliżej niż ${Game.cfg.interact_radius} m, żeby handlować.` : ''),
      h('div', { class: 'ornament' }),
      h('div', { class: 'section-title' }, 'Towar'),
    ];
    if (!m.stock.length) parts.push(h('p', { class: 'muted' }, 'Kram jest pusty.'));
    for (const s of m.stock) {
      parts.push(h('div', { class: 'row', style: { padding: '5px 0', borderBottom: '1px solid rgba(59,50,41,.5)' } },
        g(s.glyph), h('span', { title: s.description }, `${s.name} ×${s.qty}`), h('span', { class: 'spacer' }),
        h('span', { class: 'sc muted' }, money(s.price)),
        m.own ? h('button', { class: 'btn small ghost', onclick: () => this.op(m.id, 'unstock', { item: s.item }) }, 'Zdejmij')
          : h('button', { class: 'btn small', disabled: !m.active || far || ch.coins < s.price, onclick: () => this.op(m.id, 'buy', { item: s.item, qty: 1 }) }, 'Kup')));
    }
    if (m.own) {
      const inv = Game.state.inventory;
      const sel = h('select', {}, inv.map(i => h('option', { value: i.id }, `${i.name} (×${i.qty})`)));
      const qty = h('input', { type: 'number', min: 1, value: 1, style: { width: '80px' } });
      const price = h('input', { type: 'number', min: 1, style: { width: '110px' }, placeholder: 'cena w gr' });
      const suggest = () => { const it = inv.find(i => i.id === sel.value); if (it) price.value = Math.max(1, Math.round((it.value || 1) * 1.5)); };
      sel.addEventListener('change', suggest); suggest();
      const days = h('select', { style: { width: '120px' } }, [1, 3, 7, 14].map(d => h('option', { value: d }, `${d} ${plural(d, 'dzień', 'dni', 'dni')}`)));
      parts.push(
        h('div', { class: 'section-title' }, 'Wyłóż towar z torby'),
        h('div', { class: 'row wrap' }, sel),
        h('div', { class: 'row', style: { marginTop: '6px' } }, qty, price, h('span', { class: 'faint', style: { fontSize: '12px' } }, '100 gr = 1 dobrota')),
        h('button', { class: 'btn small', style: { marginTop: '8px' }, disabled: !inv.length || far || !m.active, onclick: () => this.op(m.id, 'stock', { item: sel.value, qty: +qty.value, price: +price.value }) }, 'Wyłóż na kram'),
        far ? h('div', { class: 'faint', style: { fontSize: '12px' } }, 'Towar wykładasz, stojąc przy kramie.') : null,
        h('div', { class: 'section-title' }, 'Szkatuła i opłaty'),
        h('div', { class: 'card' },
          h('div', { class: 'row' }, h('span', {}, `Utarg: ${money(m.till || 0)}`), h('span', { class: 'spacer' }),
            h('button', { class: 'btn small primary', disabled: !m.till, onclick: () => this.op(m.id, 'collect') }, 'Odbierz')),
          h('div', { class: 'row', style: { marginTop: '8px' } }, days,
            h('button', { class: 'btn small', onclick: () => this.op(m.id, 'extend', { days: +days.value }) }, 'Opłać kupca'),
            h('span', { class: 'faint', style: { fontSize: '12px' } }, `${money(Game.state.merchant_cfg.day_cost)} za dzień`))),
        h('button', { class: 'btn ghost small', style: { marginTop: '10px', color: '#e0745f' }, onclick: () => { if (confirm('Zwinąć kram? Towar i utarg wrócą do ciebie.')) this.op(m.id, 'close'); } }, 'Zwiń kram'),
      );
    }
    parts.push(h('button', { class: 'btn ghost block', style: { marginTop: '14px' }, onclick: () => Modal.close() }, 'Zamknij'));
    Modal.open(parts);
  },

  /** Sekcja „Twój kram” w panelu Obozowisko */
  campSection(body) {
    const st = Game.state;
    body.append(h('div', { class: 'section-title' }, 'Kram (twój kupiec)'));
    const cost = st.merchant_cfg.day_cost;
    if (!st.merchants.length) {
      const name = h('input', { placeholder: `Kram ${st.char.name}`, maxlength: 40 });
      const days = h('select', {}, [1, 3, 7, 14].map(d => h('option', { value: d }, `${d} ${plural(d, 'dzień', 'dni', 'dni')} — ${money(cost * d)}`)));
      body.append(h('div', { class: 'card' },
        h('p', { style: { margin: '0 0 8px' } }, 'Najmij kupca, który stanie tu, gdzie jesteś, i będzie sprzedawał twój towar innym łowcom. Płacisz z góry za dni handlu, a utarg odbierasz w każdej chwili.'),
        h('label', {}, 'Nazwa kramu'), name, h('label', {}, 'Na ile dni'), days,
        h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: async () => {
          try {
            const r = await API.post('/merchant/create', { name: name.value, days: +days.value });
            Game.applyState(r.state, { silent: true }); toastAll(r.result.messages, 'good'); Game.loadWorld();
          } catch (e) { toast(e.message, 'err'); }
        } }, 'Postaw kupca tutaj')));
      return;
    }
    for (const m of st.merchants) {
      body.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', { style: { fontSize: '26px' } }, g('🧺')),
          h('div', { style: { flex: 1 } }, h('strong', {}, m.name),
            h('div', { class: 'muted', style: { fontSize: '13px' } }, `${m.active ? `jeszcze ${m.left_h} h` : 'kupiec odszedł'} · ${m.stock.length} ${plural(m.stock.length, 'towar', 'towary', 'towarów')} · utarg: ${money(m.till || 0)}`))),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn small', onclick: () => this.open(m.id) }, 'Zarządzaj'),
          h('button', { class: 'btn small ghost', onclick: () => { if (!MapView.disabled) { MapView.follow = false; MapView.map.setView([m.lat, m.lng], 17); } Sheet.close(); } }, 'Pokaż na mapie'))));
    }
  },
};
