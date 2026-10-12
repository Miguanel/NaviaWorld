/* Torba (przeciąganie przedmiotów, dymki craftingu) i księga receptur */
const Bag = {
  filter: 'all',
  combineFrom: null,
  drag: null,

  render(body) {
    const inv = Game.state.inventory;
    const cats = [...new Set(inv.map(i => i.category))];
    body.append(h('p', { class: 'hint' }, 'Przeciągnij przedmiot na inny (na telefonie: przytrzymaj i przeciągnij), żeby sprawdzić, co z nich powstanie. Dotknij, żeby obejrzeć.'));
    if (this.combineFrom) {
      const it = inv.find(i => i.id === this.combineFrom);
      body.append(h('div', { class: 'card row' }, g(it?.glyph), h('span', {}, `Łączysz: ${it?.name}. Wybierz drugi przedmiot.`),
        h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => { this.combineFrom = null; Sheet.refresh(); } }, 'Anuluj')));
    }
    const f = h('div', { class: 'filters' },
      h('button', { class: 'chip' + (this.filter === 'all' ? ' on' : ''), onclick: () => { this.filter = 'all'; Sheet.refresh(); } }, `Wszystko (${inv.length})`),
      cats.map(c => h('button', { class: 'chip' + (this.filter === c ? ' on' : ''), onclick: () => { this.filter = c; Sheet.refresh(); } }, CAT_NAMES[c] || c)));
    body.append(f);
    const grid = h('div', { class: 'inv-grid' });
    const shown = inv.filter(i => this.filter === 'all' || i.category === this.filter)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    for (const it of shown) {
      const s = h('div', { class: `slot r-${it.rarity}${this.combineFrom === it.id ? ' selected' : ''}`, 'data-item': it.id, title: it.name },
        h('span', { class: 'n' }, it.name), g(it.glyph), h('span', { class: 'q' }, it.qty));
      this.bindDrag(s, it);
      grid.append(s);
    }
    if (!shown.length) grid.append(h('div', { class: 'muted' }, 'Pusto. Idź do lasu, na łąkę albo nad rzekę.'));
    body.append(grid);
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
    this.detail(it);
  },

  describeEffects(eff) {
    const out = [];
    if (!eff) return out;
    if (eff.heal) out.push(`${eff.heal > 0 ? '+' : ''}${eff.heal} HP`);
    if (eff.vigor) out.push(`+${eff.vigor} wigoru`);
    if (eff.toxicity) out.push(`${eff.toxicity > 0 ? '+' : ''}${eff.toxicity} toksyczności`);
    if (eff.effect) out.push(`${eff.effect.name}: ${Game.fmtStats(eff.effect.stats)} na ${eff.effect.minutes} min`);
    if (eff.mutation) out.push(`Przemiana „${eff.mutation.name}”: ${Game.fmtStats(eff.mutation.stats)} na zawsze · ryzyko ${Math.round((eff.risk || 0) * 100)}%`);
    if (eff.oil) out.push(`Olej: +${Math.round(eff.oil.bonus * 100)}% obrażeń przeciw: ${eff.oil.family}`);
    if (eff.throw) out.push(`W walce można rzucić (${eff.throw.dmg} obr., silniej na: ${(eff.throw.family || []).join(', ') || 'wszystko'})`);
    if (eff.attack) out.push(`Atak +${eff.attack}${(eff.tags || []).length ? ' · ' + eff.tags.join(', ') : ''}`);
    if (eff.armor) out.push(`Pancerz +${eff.armor}`);
    return out;
  },

  detail(it) {
    const st = Game.state;
    const effs = this.describeEffects(it.effects);
    if (it.tool_bonus) effs.push(`Narzędzie: +${it.tool_bonus}% do szansy wytworzenia`);
    if (it.catalyst_bonus) effs.push(`Katalizator: +${it.catalyst_bonus}% do każdej receptury`);
    const acts = h('div', { class: 'row wrap', style: { marginTop: '14px' } });
    if (it.usable) acts.append(h('button', { class: 'btn primary', onclick: () => Game.useItem(it.id) }, ['eliksir', 'wywar'].includes(it.category) ? 'Wypij' : 'Użyj'));
    if (it.placeable) {
      acts.append(h('button', { class: 'btn', disabled: !st.site.my_camp, onclick: () => Game.place(it.id, 'camp') }, 'Postaw w obozie'));
      acts.append(h('button', { class: 'btn', disabled: !st.site.at_own_base, onclick: () => Game.place(it.id, 'base') }, 'Postaw w siedlisku'));
    }
    acts.append(h('button', { class: 'btn', onclick: () => { Modal.close(); this.suggest([it.id], innerWidth / 2, innerHeight / 3); } }, it.is_tool ? 'Użyj narzędzia' : 'Receptury z tym'));
    acts.append(h('button', { class: 'btn', onclick: () => { Modal.close(); this.combineFrom = it.id; Sheet.refresh(); } }, 'Połącz z…'));
    acts.append(h('button', { class: 'btn', onclick: () => { Modal.close(); Finder.search(it.id); } }, '🧭 Gdzie zdobyć więcej?'));
    acts.append(h('button', { class: 'btn ghost small', onclick: () => Game.drop(it.id) }, 'Wyrzuć 1'));
    Modal.open([
      h('div', { class: 'row' }, h('div', { style: { fontSize: '54px' } }, g(it.glyph)),
        h('div', {}, h('div', { class: 'event-kicker' }, `${CAT_NAMES[it.category] || it.category} · ${it.rarity}`),
          h('h2', { style: { fontSize: '28px' } }, it.name), h('div', { class: 'muted sc' }, `×${it.qty} · wartość ${money(it.value)}`))),
      h('div', { class: 'ornament' }),
      h('p', { class: 'event-text', style: { fontSize: '16px' } }, it.description),
      effs.length ? h('ul', { class: 'loot-list' }, effs.map(e => h('li', {}, e))) : null,
      acts,
    ]);
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

/* ----------------------------------------------------------------- Receptury */
const Recipes = {
  list: [],
  open: {},
  selected: {},
  focus: null,
  query: '',

  async render(body) {
    body.append(h('div', { class: 'muted' }, 'Wczytuję księgę…'));
    try { this.list = (await API.get('/recipes')).recipes; } catch (e) { body.innerHTML = ''; return body.append(h('p', {}, e.message)); }
    body.innerHTML = '';
    if (this.focus) { this.open[this.focus] = true; }
    const search = h('input', { placeholder: 'Szukaj receptury…', value: this.query });
    search.addEventListener('input', () => { this.query = search.value; this.paint(listEl); });
    const listEl = h('div', {});
    body.append(h('p', { class: 'hint' }, 'Szansę podnoszą: Alchemia, narzędzia (np. alembik, kocioł) i katalizatory. Zaznacz katalizator, by go dodać.'), search, h('div', { style: { height: '10px' } }), listEl);
    this.paint(listEl);
    if (this.focus) {
      const el = document.getElementById('rc-' + this.focus);
      if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
      this.focus = null;
    }
  },

  chance(r) {
    const sel = this.selected[r.id] || new Set(r.catalysts.filter(c => c.selected).map(c => c.item));
    this.selected[r.id] = sel;
    let bonus = 0;
    for (const c of r.catalysts) if (sel.has(c.item) && c.have) bonus += c.bonus;
    const b = r.breakdown;
    const raw = (b.base || 0) + b.alchemia + b.narzedzia + bonus;
    return { val: Math.max(3, Math.min(97, raw)), bonus };
  },

  paint(listEl) {
    listEl.innerHTML = '';
    const q = this.query.toLowerCase();
    const items = this.list.filter(r => !q || r.name.toLowerCase().includes(q) || r.result.name.toLowerCase().includes(q));
    if (!items.length) listEl.append(h('p', { class: 'muted' }, 'Brak receptur.'));
    for (const r of items) listEl.append(this.card(r, listEl));
  },

  card(r, listEl) {
    const ch = this.chance(r);
    const isOpen = !!this.open[r.id];
    const el = h('div', { class: 'recipe' + (r.can ? ' can' : ''), id: 'rc-' + r.id });
    el.append(h('div', { class: 'recipe-head', onclick: () => { this.open[r.id] = !isOpen; this.paint(listEl); } },
      h('span', { class: 'big' }, g(r.result.glyph)),
      h('div', {}, h('h4', {}, r.name + (r.result.qty > 1 ? ` ×${r.result.qty}` : '')),
        h('div', { class: 'muted', style: { fontSize: '12.5px' } }, r.can ? 'Gotowe do wykonania' : 'Brakuje: ' + r.missing.slice(0, 3).join(', ') + (r.missing.length > 3 ? '…' : ''))),
      h('div', { class: 'chance' }, Math.round(ch.val) + '%', h('small', {}, 'szansa'))));
    if (!isOpen) return el;
    if (r.description) el.append(h('p', { class: 'muted', style: { fontStyle: 'italic', margin: '8px 0 0' } }, r.description));
    el.append(h('div', { class: 'section-title' }, 'Składniki'),
      h('div', { class: 'req' }, r.ingredients.map(i => h('button', {
        class: 'chip req-find ' + (i.have >= i.qty ? 'good' : 'bad'), title: 'Pokaż strzałkę do miejsca, gdzie to zdobyć',
        onclick: () => Finder.guide(i.item),
      }, g(i.glyph), `${i.name} ${i.have}/${i.qty} `, g('🧭')))),
      h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '4px' } }, 'Dotknij składnika — na mapie pojawi się strzałka do miejsca, gdzie go zdobędziesz.'));
    if (r.tools.length) {
      const where = { any: '', bag: ' (w torbie)', placed: ' (postawione)' }[r.tool_mode] || '';
      el.append(h('div', { class: 'section-title' }, 'Narzędzia' + where),
        h('div', { class: 'req' }, r.tools.map(t => h('button', { class: 'chip req-find ' + (t.source ? 'good' : 'bad'), onclick: () => Finder.guide(t.item) }, g(t.glyph), t.name,
          t.source ? h('small', { class: 'muted' }, ' · ' + ({ bag: 'torba', placed: 'postawione', building: 'warsztat' }[t.source])) : ''))));
    }
    el.append(h('div', { class: 'section-title' }, 'Miejsce'),
      h('div', { class: 'req' }, h('span', { class: 'chip ' + (r.station.ok ? 'good' : 'bad') }, r.station.label)));
    if (r.catalysts.length) {
      el.append(h('div', { class: 'section-title' }, 'Katalizatory i pomoce'));
      const box = h('div', { class: 'req' });
      for (const c of r.catalysts) {
        const on = this.selected[r.id].has(c.item);
        const chip = h('button', {
          class: 'chip cat-toggle ' + (!c.have ? 'off' : on ? 'on' : ''),
          title: c.tool ? 'Pomocnicze narzędzie — działa samo, gdy jest pod ręką' : 'Zużywane przy tworzeniu',
          onclick: () => {
            if (!c.have || c.tool) return;
            on ? this.selected[r.id].delete(c.item) : this.selected[r.id].add(c.item);
            this.paint(listEl);
          },
        }, g(c.glyph), `${c.name} +${c.bonus}%`, c.tool ? ' ⚒' : '', c.universal ? ' ✦' : '');
        box.append(chip);
      }
      el.append(box);
    }
    const b = r.breakdown;
    el.append(h('div', { class: 'chance-bar' }, h('i', { style: { width: ch.val + '%' } })),
      h('div', { class: 'breakdown' }, `baza ${b.base}% + alchemia ${b.alchemia}% + narzędzia ${b.narzedzia}% + katalizatory ${ch.bonus}% = ${Math.round(ch.val)}%`),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('span', { class: 'muted', style: { fontSize: '13px' } }, `Wynik: ${r.result.name}`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn primary', disabled: !r.can, onclick: () => this.craft(r.id, [...this.selected[r.id]]) }, 'Twórz')));
    return el;
  },

  async craft(id, catalysts) {
    try {
      const r = await API.post('/craft', { recipe: id, catalysts });
      Game.applyState(r.state);
      const res = r.result;
      Modal.open([
        h('div', { class: 'event-kicker' }, `Szansa ${res.chance}% · rzut ${res.roll}`),
        h('h2', { class: 'event-title' }, res.success ? 'Udało się' : 'Porażka'),
        h('p', { class: 'event-text' }, res.text),
        res.messages.length ? h('ul', { class: 'loot-list' }, res.messages.map(m => h('li', {}, m))) : null,
        h('button', { class: 'btn block', style: { marginTop: '14px' }, onclick: () => Modal.close() }, 'Dalej'),
      ]);
      delete this.selected[id];
      if (Sheet.current === 'recipes' || Sheet.current === 'bag') Sheet.refresh();
    } catch (e) { toast(e.message, 'err'); }
  },
};
