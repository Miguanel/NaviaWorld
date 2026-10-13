/* Obóz i siedlisko w oknach: plan obozu → „Rozbuduj” (lista wszystkich budynków z podglądem jak w recepturach)
   → okno użycia każdego postawionego budynku. */
const CampUI = {
  buildOpen: null,       // rozwinięta karta w oknie rozbudowy (jedna naraz)
  buildFilter: 'all',
  structOpen: null,      // rozwinięta receptura w oknie budynku
  sel: {},

  where(kind) { return kind === 'base' ? 'base' : 'camp'; },

  async act(path, body, { reload = true } = {}) {
    try {
      const r = await API.post(path, body);
      Game.applyState(r.state, { silent: true });
      const res = r.result || {};
      if (res.text) toast(res.text, 'good');
      toastAll(res.messages, 'good');
      Game.loadWorld();
      if (reload) await Win.refresh();
      return res;
    } catch (e) { toast(e.message, 'err'); return null; }
  },

  /** Wskazanie miejsca na mapie chowa okno; po wyborze wraca do wskazanego okna. */
  pick(text, run, reopen) {
    Win.close();
    Game.pickOnMap(text, async ll => { await run(ll); if (reopen) reopen(); });
  },

  // ----------------------------------------------------------------- plan obozu / siedliska
  openSite(kind, owner) {
    MapView.map && MapView.map.closePopup();
    Win.open(this.siteWindow(kind, owner));
  },

  siteWindow(kind, owner) {
    const isCamp = kind === 'camp';
    return {
      glyph: isCamp ? '🔥' : '🏚️', kicker: isCamp ? 'Twój obóz' : 'Siedlisko', title: isCamp ? 'Obóz' : 'Siedlisko',
      render: async (body, api) => {
        const v = await API.get(`/site/${kind}` + (owner ? `?owner=${owner}` : ''));
        if (!v) throw new Error(isCamp ? 'Nie masz rozbitego obozu. Rozbij go w zakładce Obozowisko (4 × drewno i krzesiwo).' : 'Brak siedliska.');
        this.renderSite(body, v, api);
      },
    };
  },

  renderSite(body, v, api) {
    const isCamp = v.type === 'camp';
    const own = isCamp || v.own;
    const where = isCamp ? 'camp' : 'base';
    api.setTitle(v.name);
    api.setKicker(isCamp ? 'Twój obóz' : (v.own ? 'Twoje siedlisko' : 'Siedlisko gościnne'));
    const conn = v.structures.filter(s => s.connected).length;
    const pos = Game.pos;
    body.append(
      h('p', { class: 'muted', style: { marginTop: 0 } }, (isCamp ? `Ogień dogaśnie za ${v.left_h} h. ` : '') +
        `Centrum ma krąg ${v.radius} m. Połączonych budynków: ${conn} z ${v.structures.length}.`),
      own ? h('div', { class: 'site-actions' },
        h('button', { class: 'btn primary', onclick: () => Win.push(this.buildWindow(where)) }, '🔨 Rozbuduj'),
        isCamp ? h('button', { class: 'btn', onclick: () => this.act('/camp/feed', {}) }, '🪵 Dorzuć 2 drewna (+6 h)') : null,
        h('button', { class: 'btn ghost', onclick: () => { Win.close(); MapView.follow = false; MapView.map && MapView.map.setView([v.lat, v.lng], 17); } }, 'Pokaż na mapie')) : null,
      h('div', { class: 'section-title' }, `Budynki (${v.structures.length})`));
    if (!v.structures.length) {
      body.append(h('div', { class: 'card empty-site' }, h('p', { style: { margin: '0 0 8px' } }, 'Jeszcze nic tu nie stoi.'),
        own ? h('button', { class: 'btn small', onclick: () => Win.push(this.buildWindow(where)) }, '🔨 Otwórz rozbudowę') : null));
    }
    for (const s of v.structures) {
      const cost = (s.repair_cost || []).map(r => `${Game.content.items[r.item]?.name || r.item} ×${r.qty}`).join(', ');
      const d = distM(pos[0], pos[1], s.lat, s.lng);
      body.append(h('div', { class: 'site-struct' + (s.broken ? ' broken' : '') },
        h('button', { class: 'sg', title: 'Otwórz budynek', onclick: () => Win.push(this.structWindow(s.id)) }, g(s.glyph)),
        h('div', {},
          h('div', { class: 'row' }, h('strong', {}, s.name), h('span', { class: 'spacer' }),
            h('span', { class: 'chip ' + (s.connected ? 'ok' : 'warn') }, s.connected ? 'połączony' : 'osobno')),
          h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } }, h('div', { class: 'dur' }, h('i', { style: { width: s.pct + '%' } })),
            h('span', { class: 'faint', style: { fontSize: '12px' } }, `${s.pct}% · krąg ${Math.round(s.radius)} m · ${fmtDist(d)} stąd`)),
          h('div', { class: 'row wrap', style: { marginTop: '6px' } },
            h('button', { class: 'btn small' + (s.uses ? ' primary' : ''), onclick: () => Win.push(this.structWindow(s.id)) }, s.uses ? `✦ Użyj (${s.uses})` : 'Otwórz'),
            h('button', { class: 'btn small', onclick: () => this.act('/structure/repair', { id: s.id }) }, 'Napraw' + (cost ? ` (${cost})` : '')),
            own ? h('button', { class: 'btn small ghost', onclick: () => this.act('/structure/pickup', { id: s.id }) }, 'Zabierz') : null))));
    }
    body.append(h('details', { class: 'octo' }, h('summary', {}, 'Jak działa obszar obozu?'),
      h('p', {}, 'Każdy budynek ma mały krąg. Jeśli styka się z centrum albo z innym połączonym budynkiem, ich obszary zlewają się w jedną „ośmiornicę” — w całym jej zasięgu korzystasz z każdego połączonego budynku. Budynek postawiony osobno działa tylko, gdy stoisz w jego kręgu. Częstokół ma duży krąg i świetnie łączy odległe budynki.')));
    if (own) {
      const reopen = () => this.openSite(v.type, v.type === 'base' ? v.owner_id : undefined);
      body.append(h('div', { class: 'section-title' }, 'Przeniesienie'),
        h('p', { class: 'muted', style: { marginTop: 0 } }, `Wszystkie budynki przeniosą się razem z ${isCamp ? 'obozem' : 'siedliskiem'}, zachowując układ.`),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn small', onclick: () => this.pick(`Wskaż nowe miejsce ${isCamp ? 'obozu' : 'siedliska'} na mapie.`,
            ll => this.act('/site/move', { where, lat: ll.lat, lng: ll.lng }, { reload: false }), reopen) }, '✥ Wskaż na mapie'),
          h('button', { class: 'btn small ghost', onclick: () => this.act('/site/move', { where, lat: pos[0], lng: pos[1] }) }, 'Przenieś tutaj')));
    }
  },

  // ----------------------------------------------------------------- okno rozbudowy
  /** Otwiera rozbudowę od razu (z „◂ Wróć” do planu obozu). */
  openBuild(where) {
    Win.open(this.siteWindow(where));
    Win.push(this.buildWindow(where));
  },

  buildWindow(where) {
    return {
      glyph: '🔨', kicker: where === 'camp' ? 'Obóz' : 'Siedlisko', title: 'Rozbudowa',
      render: async body => { this.renderBuild(body, await API.get(`/site/${where}/buildables`)); },
    };
  },

  renderBuild(body, data) {
    const where = data.where;
    const list = data.buildings;
    const n = { all: list.length, bag: list.filter(b => b.in_bag).length, can: list.filter(b => b.recipe && b.recipe.can).length };
    body.append(h('p', { class: 'hint', style: { marginTop: 0 } },
      `Zbudowany budynek stanie tam, gdzie jesteś, albo w miejscu wskazanym na mapie — najdalej ${data.build_reach} m od ciebie i ${data.spread} m od centrum. Jeśli budowa się nie uda, składniki przepadają jak przy recepturze.`));
    const listEl = h('div', {});
    const paintFilters = h('div', { class: 'filters' });
    const paint = () => {
      paintFilters.innerHTML = '';
      for (const [k, label] of [['all', `Wszystkie ${n.all}`], ['can', `🔨 Mogę zbudować ${n.can}`], ['bag', `👜 W torbie ${n.bag}`]]) {
        paintFilters.append(h('button', { class: 'chip' + (this.buildFilter === k ? ' on' : ''), onclick: () => { this.buildFilter = k; paint(); } }, label));
      }
      listEl.innerHTML = '';
      const shown = list.filter(b => this.buildFilter === 'all' || (this.buildFilter === 'bag' ? b.in_bag : b.recipe && b.recipe.can));
      if (!shown.length) listEl.append(h('p', { class: 'muted' }, this.buildFilter === 'bag' ? 'Nie masz w torbie żadnego budynku.' : 'Na razie niczego nie zbudujesz — zobacz w „Wszystkie”, czego brakuje.'));
      for (const b of shown) listEl.append(this.buildCard(b, where, paint));
    };
    body.append(paintFilters, listEl);
    paint();
  },

  buildCard(b, where, repaint) {
    const open = this.buildOpen === b.item;
    const r = b.recipe;
    const sel = r ? (this.sel[r.id] = this.sel[r.id] || RecipeView.defaultSel(r)) : new Set();
    const toggle = () => { this.buildOpen = open ? null : b.item; repaint(); if (!open) setTimeout(() => document.getElementById('bd-' + b.item)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30); };
    const status = b.in_bag ? h('span', { class: 'rc-ok' }, `W torbie ×${b.in_bag} — możesz postawić od razu`)
      : r ? RecipeView.status(r)
        : b.unknown ? h('span', { class: 'rc-miss' }, `Nie znasz receptury${b.unknown.where.length ? ' — uczą: ' + b.unknown.where.join(', ') : ''}`)
          : h('span', { class: 'rc-miss' }, 'Nie da się tego wytworzyć — tylko znaleźć lub kupić');
    const right = b.in_bag ? h('div', { class: 'chance' }, `×${b.in_bag}`, h('small', {}, 'w torbie'))
      : r ? h('div', { class: 'chance' }, Math.round(RecipeView.chance(r, sel).val) + '%', h('small', {}, 'szansa'))
        : h('div', { class: 'chance locked' }, '🔒', h('small', {}, 'nieznana'));
    const el = h('div', { class: 'recipe build-card' + (b.in_bag || (r && r.can) ? ' can' : '') + (open ? ' open' : '') + (!r && !b.in_bag ? ' locked' : ''), id: 'bd-' + b.item },
      h('div', { class: 'recipe-head', role: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: toggle },
        h('span', { class: 'big' }, g(b.glyph)),
        h('div', { class: 'rh-text' }, h('h4', {}, b.name, b.placed ? h('span', { class: 'placed-badge' }, `stoi: ${b.placed}`) : null),
          h('div', { class: 'muted', style: { fontSize: '12.5px' } }, status)),
        right, h('span', { class: 'rh-arrow' }, open ? '▾' : '▸')));
    if (!open) return el;
    el.append(h('p', { class: 'muted', style: { fontStyle: 'italic', margin: '8px 0 0' } }, b.description));
    // Co daje budynek
    const facts = [`krąg ${Math.round(b.radius)} m`];
    if (b.max_durability) facts.push(`wytrzymałość ${b.max_durability}`);
    if (b.decay_per_hour) facts.push(`niszczeje −${String(b.decay_per_hour).replace('.', ',')}/h`);
    if (b.tool_bonus) facts.push(`jako narzędzie +${b.tool_bonus}% szansy`);
    el.append(h('div', { class: 'section-title' }, 'Budynek'), h('div', { class: 'bb-stats' }, facts.map(f => h('span', { class: 'bb-stat' }, f))));
    if (b.uses.length) {
      el.append(h('div', { class: 'section-title' }, 'Co można w nim robić'));
      for (const u of b.uses) el.append(this.usePreview(u));
    }
    if (b.tool_for.length) {
      el.append(h('div', { class: 'section-title' }, 'Pomaga przy recepturach'),
        h('div', { class: 'req' }, b.tool_for.map(t => h('span', { class: 'chip' }, t.name, h('small', { class: 'muted' }, ' · ' + t.as)))));
    }
    if (b.repair_cost.length) {
      el.append(h('div', { class: 'section-title' }, 'Naprawa'),
        h('div', { class: 'req' }, b.repair_cost.map(c => h('span', { class: 'chip' }, g(c.glyph), `${c.name} ×${c.qty}`))));
    }
    if (r) {
      el.append(h('div', { class: 'section-title', style: { color: 'var(--ember)' } }, `Budowa — ${r.name}`));
      el.append(...RecipeView.details(r, sel, repaint));
    } else if (b.unknown) {
      el.append(h('div', { class: 'section-title' }, 'Receptura'),
        h('p', { class: 'muted', style: { margin: 0 } }, `„${b.unknown.name}” — tej receptury jeszcze nie znasz.` + (b.unknown.where.length ? ` Naucz się jej: ${b.unknown.where.join(', ')}.` : '')));
    }
    const reopen = () => this.openBuild(where);
    const acts = h('div', { class: 'sd-actions', style: { marginTop: '12px' } });
    if (b.in_bag) {
      acts.append(h('button', { class: 'btn primary', onclick: () => this.act('/structure/place', { item: b.item, where }) }, '📍 Postaw tutaj'),
        h('button', { class: 'btn', onclick: () => this.pick(`Wskaż, gdzie postawić: ${b.name}.`, ll => this.act('/structure/place', { item: b.item, where, lat: ll.lat, lng: ll.lng }, { reload: false }), reopen) }, '✥ Wskaż na mapie'));
    }
    if (r) {
      const build = async ll => {
        try {
          const res = await API.post('/site/build', { where, recipe: r.id, catalysts: [...sel], ...(ll ? { lat: ll.lat, lng: ll.lng } : {}) });
          Game.applyState(res.state, { silent: true });
          Game.loadWorld();
          delete this.sel[r.id];
          RecipeView.showResult(res.result, res.result.success ? `Stoi: ${b.name}` : 'Budowa się nie udała');
          if (Win.isOpen) await Win.refresh();
        } catch (e) { toast(e.message, 'err'); }
      };
      acts.append(h('button', { class: 'btn' + (b.in_bag ? '' : ' primary'), disabled: !r.can, onclick: () => build(null) }, '🔨 Zbuduj tutaj'),
        h('button', { class: 'btn', disabled: !r.can, onclick: () => this.pick(`Wskaż, gdzie zbudować: ${b.name}.`, build, reopen) }, 'Zbuduj — wskaż na mapie'));
    }
    if (!b.in_bag && !r) acts.append(h('button', { class: 'btn', onclick: () => Finder.search(b.item) }, '🧭 Gdzie to zdobyć?'));
    el.append(acts);
    return el;
  },

  usePreview(u) {
    return h('div', { class: 'use-row preview' },
      h('span', { class: 'ug' }, g(u.glyph)),
      h('div', {}, h('strong', {}, u.label),
        u.gives.length ? h('div', { class: 'bb-stats' }, u.gives.map(x => h('span', { class: 'bb-stat up' }, x))) : null,
        h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '2px' } },
          [u.cost.length ? 'koszt: ' + u.cost.map(c => `${c.name} ×${c.qty}`).join(', ') : 'bez kosztu',
            u.cooldown_s ? `co ${fmtTime(u.cooldown_s)}` : null].filter(Boolean).join(' · '))));
  },

  // ----------------------------------------------------------------- okno budynku
  openStruct(id) {
    MapView.map && MapView.map.closePopup();
    Win.open(this.structWindow(id));
  },

  structWindow(id) {
    return {
      glyph: '✦', kicker: 'Budynek', title: '…',
      render: async (body, api) => { this.renderStruct(body, await API.get('/structure/' + id), api); },
    };
  },

  renderStruct(body, s, api) {
    api.setTitle(s.name);
    api.setKicker(s.site === 'camp' ? 'Budynek w obozie' : 'Budynek w siedlisku');
    const t = Date.now();
    body.append(h('div', { class: 'struct-hero' },
      h('div', { class: 'sh-glyph' }, g(s.glyph)),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('p', { class: 'muted', style: { fontStyle: 'italic', margin: '0 0 6px' } }, s.description),
        h('div', { class: 'row', style: { gap: '6px' } }, h('div', { class: 'dur' }, h('i', { style: { width: s.pct + '%' } })),
          h('span', { class: 'faint', style: { fontSize: '12px' } }, `${s.pct}% · −${s.decay_per_hour}/h`)),
        h('div', { class: 'row wrap', style: { marginTop: '6px', gap: '6px' } },
          h('span', { class: 'chip ' + (s.connected ? 'ok' : 'warn') }, s.connected ? 'połączony z obszarem' : 'stoi osobno'),
          h('span', { class: 'chip' }, `krąg ${Math.round(s.radius)} m`),
          s.tool_bonus ? h('span', { class: 'chip' }, `narzędzie +${s.tool_bonus}%`) : null))));
    if (!s.in_reach) {
      body.append(h('div', { class: 'warn-box' }, `Jesteś ${fmtDist(s.dist)} stąd. Żeby użyć budynku, stań w jego kręgu albo w połączonym z nim obszarze obozu.`));
    }
    if (s.broken) body.append(h('div', { class: 'warn-box' }, 'Budynek jest zniszczony — napraw go, zanim z niego skorzystasz.'));
    body.append(h('div', { class: 'section-title' }, 'Działania'));
    if (!s.uses.length) body.append(h('p', { class: 'muted' }, 'Ten budynek nie ma własnych działań — działa jako narzędzie albo łączy obszar obozu.'));
    for (const u of s.uses) {
      const cd = u.cooldown_left > 0;
      const btn = h('button', {
        class: 'btn primary', disabled: !s.in_reach || s.broken || cd || !u.can_pay,
        onclick: () => this.act('/structure/use', { id: s.id, index: u.index }),
      }, cd ? `za ${fmtTime(u.cooldown_left)}` : u.label);
      if (cd) {
        const until = t + u.cooldown_left * 1000;
        const iv = setInterval(() => {
          if (!btn.isConnected) return clearInterval(iv);
          const left = Math.round((until - Date.now()) / 1000);
          if (left <= 0) { clearInterval(iv); btn.textContent = u.label; btn.disabled = !s.in_reach || s.broken || !u.can_pay; } else btn.textContent = `za ${fmtTime(left)}`;
        }, 1000);
      }
      body.append(h('div', { class: 'use-row' },
        h('span', { class: 'ug' }, g(u.glyph)),
        h('div', { class: 'use-main' },
          h('strong', {}, u.label),
          u.text ? h('div', { class: 'muted', style: { fontStyle: 'italic', fontSize: '13.5px' } }, u.text) : null,
          u.gives.length ? h('div', { class: 'bb-stats', style: { marginTop: '4px' } }, u.gives.map(x => h('span', { class: 'bb-stat up' }, x))) : null,
          h('div', { class: 'req', style: { marginTop: '4px' } },
            u.cost.map(c => h('span', { class: 'chip ' + (c.have >= c.qty ? 'good' : 'bad') }, g(c.glyph), `${c.name} ${c.have}/${c.qty}`)),
            u.cooldown_s ? h('span', { class: 'chip' }, `⏳ co ${fmtTime(u.cooldown_s)}`) : null,
            u.wear ? h('span', { class: 'chip' }, `zużycie −${u.wear}`) : null)),
        btn));
    }
    if (s.recipes.length) {
      body.append(h('div', { class: 'section-title' }, `Receptury przy tym budynku (${s.recipes.length})`));
      const listEl = h('div', {});
      const paint = () => {
        listEl.innerHTML = '';
        for (const r of s.recipes) {
          const sel = this.sel[r.id] = this.sel[r.id] || RecipeView.defaultSel(r);
          listEl.append(RecipeView.card(r, {
            open: this.structOpen === r.id, sel, repaint: paint,
            onToggle: () => { this.structOpen = this.structOpen === r.id ? null : r.id; paint(); },
            onCraft: (rr, cats) => RecipeView.craft(rr.id, cats, () => { delete this.sel[rr.id]; Win.refresh(); }),
          }));
        }
      };
      paint();
      body.append(listEl);
    }
    const cost = s.repair_cost.map(c => `${c.name} ${c.have}/${c.qty}`).join(', ');
    body.append(h('div', { class: 'section-title' }, 'Utrzymanie'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: () => this.act('/structure/repair', { id: s.id }) }, 'Napraw' + (cost ? ` (${cost})` : '')),
        s.own ? h('button', { class: 'btn small ghost', onclick: async () => { const r = await this.act('/structure/pickup', { id: s.id }, { reload: false }); if (r) Win.back(); } }, 'Zabierz do torby') : null,
        h('button', { class: 'btn small ghost', onclick: () => { Win.close(); MapView.follow = false; MapView.map && MapView.map.setView([s.lat, s.lng], 18); } }, 'Pokaż na mapie')));
  },
};
