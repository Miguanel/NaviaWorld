/* Mapa: Leaflet + nakładki terenów, punktów mocy, budynków, obozów i graczy */
const MapView = {
  map: null,
  layers: {},
  me: null,
  meRange: null,
  content: null,
  lastWorldAt: null,
  follow: true,

  init(content, lat, lng) {
    this.content = content;
    if (!window.L) {
      // Leaflet nie wczytał się (brak internetu / zablokowany CDN) — gra działa dalej bez mapy.
      this.disabled = true;
      document.getElementById('map').innerHTML = '<div style="position:absolute;top:45%;width:100%;text-align:center;color:#a99b82;font-style:italic;padding:0 30px">Mapa nie wczytała się — sprawdź połączenie z internetem.<br>Gra działa dalej: eksploruj, zbieraj, walcz.</div>';
      return;
    }
    this.map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 12, maxZoom: 19 })
      .setView([lat, lng], 16);
    MapView.addTiles(this.map);
    // Obszary obozów/siedlisk w osobnych warstwach z przezroczystością całej warstwy —
    // nakładające się kręgi zlewają się w jeden kształt („ośmiornicę”), bez ciemniejszych zakładek.
    for (const [pane, op] of [['campArea', .26], ['baseArea', .22]]) {
      this.map.createPane(pane);
      this.map.getPane(pane).style.opacity = op;
      this.map.getPane(pane).style.zIndex = 350;
      this.map.getPane(pane).style.pointerEvents = 'none';
    }
    for (const k of ['zones', 'power', 'buildings', 'camps', 'bases', 'merchants', 'players', 'trail']) {
      this.layers[k] = L.layerGroup().addTo(this.map);
    }
    this.me = L.marker([lat, lng], {
      icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000, interactive: false,
    }).addTo(this.map);
    this.meRange = L.circle([lat, lng], { radius: 70, color: '#d7802f', weight: 1, opacity: .4, fillOpacity: .03, dashArray: '2 6', interactive: false }).addTo(this.map);
    this.map.on('dragstart', () => { this.follow = false; });
    this.map.on('click', e => Game.onMapClick(e.latlng));
    this.map.on('zoomend', () => this.drawTrail());
  },

  /** Kafelki z konfiguracji serwera (CARTO z kluczem albo zapasowy OSM). */
  addTiles(map) {
    const t = (typeof Game !== 'undefined' && Game.cfg && Game.cfg.tiles) || (typeof Admin !== 'undefined' && Admin.tiles) ||
      { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap', subdomains: 'abc', dark: false };
    document.body.classList.toggle('light-tiles', !t.dark);
    return L.tileLayer(t.url, { subdomains: t.subdomains || 'abc', maxZoom: 19, attribution: t.attribution }).addTo(map);
  },

  setMe(lat, lng) {
    if (this.disabled) return;
    this.me.setLatLng([lat, lng]);
    this.meRange.setLatLng([lat, lng]);
    if (this.follow) this.map.panTo([lat, lng], { animate: true, duration: .4 });
    this.drawTrail();
  },

  center() { if (this.disabled) return; this.follow = true; this.map.setView(this.me.getLatLng(), Math.max(this.map.getZoom(), 16)); },

  icon(glyph, cls = '', size = 34, label = '', color = '') {
    const style = color ? `style="--pc:${color};width:${size}px;height:${size}px"` : `style="width:${size}px;height:${size}px"`;
    return L.divIcon({
      className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: `<div class="mk ${cls}" ${style}><i class="glyph">${esc(glyph)}</i>${label ? `<span class="mk-label">${esc(label)}</span>` : ''}</div>`,
    });
  },

  render(w) {
    if (this.disabled) return;
    const c = this.content;
    Object.entries(this.layers).forEach(([k, l]) => { if (k !== 'trail') l.clearLayers(); });

    for (const z of w.zones) {
      const t = c.terrains[z.kind] || { color: '#556644', name: z.kind };
      L.circle([z.lat, z.lng], {
        radius: z.radius, color: t.color, weight: 1, opacity: .45, dashArray: '4 6',
        fillColor: t.color, fillOpacity: .2, interactive: true,
      }).bindTooltip(`${esc(z.name || t.name)} · ${esc(t.name)}`, { sticky: true, direction: 'top', opacity: .95 })
        .addTo(this.layers.zones);
    }

    for (const p of w.power) {
      const k = c.power_kinds[p.kind] || { color: '#a3261a', glyph: '✶', name: p.kind, stat_mods: {} };
      // Trzy pierścienie: im bliżej środka, tym intensywniej — wizualizacja „czym bliżej, tym mocniej”.
      [1, .66, .33].forEach((f, i) => L.circle([p.lat, p.lng], {
        radius: p.radius * f, stroke: i === 0, color: k.color, weight: 1, opacity: .5, dashArray: '1 5',
        fillColor: k.color, fillOpacity: .06 + i * .05, interactive: false,
      }).addTo(this.layers.power));
      const mods = Object.entries(k.stat_mods || {}).map(([s, v]) => `${v > 0 ? '+' : ''}${v} ${Game.statName(s)}`).join(', ');
      L.marker([p.lat, p.lng], { icon: this.icon(k.glyph, 'power', 30, '', k.color) })
        .bindPopup(`<h4>${esc(p.name || k.name)}</h4><div class="sc" style="color:${k.color}">${esc(k.name)} · zasięg ${Math.round(p.radius)} m · siła ${p.strength}</div>
          <p style="margin:.5em 0">${esc(k.description || '')}</p><div class="muted">W centrum: ${esc(mods || '—')}</div>`)
        .addTo(this.layers.power);
    }

    for (const b of w.buildings) {
      const bt = c.building_types[b.kind] || { glyph: '⌂', name: b.kind };
      const m = L.marker([b.lat, b.lng], { icon: this.icon(bt.glyph, '', 38, b.name || bt.name) }).addTo(this.layers.buildings);
      m.on('click', () => Game.tapBuilding(b));
    }

    for (const cp of w.camps) {
      this.drawSite(cp, 'camp', this.layers.camps, '#d7802f', 'campArea');
      const m = L.marker([cp.lat, cp.lng], {
        icon: this.icon('🔥', 'camp', 34, `${cp.owner}${cp.own ? ' (twój)' : ''}`), opacity: .3 + .7 * Math.max(0, cp.fade),
        zIndexOffset: 200,
      });
      if (cp.own) m.on('click', () => Game.openSite('camp'));
      else m.bindPopup(`<h4>${esc(cp.name)}</h4><div class="muted">Rozpalił: ${esc(cp.owner)}</div>
        <p style="margin:.4em 0">Ogień dogaśnie za ${cp.left_h} h. Budynków: ${cp.structures.length}.</p>`);
      m.addTo(this.layers.camps);
    }

    for (const b of w.bases) {
      this.drawSite(b, 'base', this.layers.bases, '#7ea4ad', 'baseArea');
      L.marker([b.lat, b.lng], { icon: this.icon('🏚️', 'base', 36, b.own ? 'Twoje siedlisko' : `Siedlisko ${b.owner_name}`), zIndexOffset: 200 })
        .on('click', () => Game.openSite('base', b.owner_id))
        .addTo(this.layers.bases);
    }

    for (const p of w.players) {
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div class="other-marker"></div><span class="mk-label" style="top:16px">${esc(p.name)} · ${p.level}</span>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
      }).addTo(this.layers.players);
    }

    for (const m of w.merchants || []) {
      const mk = L.marker([m.lat, m.lng], { icon: this.icon('🧺', 'merchant', 34, `${m.name}${m.own ? ' (twój)' : ''}`) })
        .addTo(this.layers.merchants);
      mk.on('click', () => Game.openMerchant(m.id));
    }
  },

  /** Centrum + budynki: połączone tworzą wspólny obszar, odłączone mają własny słaby krąg. */
  drawSite(site, kind, layer, color, pane) {
    L.circle([site.lat, site.lng], { pane, radius: site.radius || Game.cfg.camp_radius, stroke: false, fillColor: color, fillOpacity: 1, interactive: false }).addTo(layer);
    for (const s of site.structures || []) {
      if (s.connected) {
        L.circle([s.lat, s.lng], { pane, radius: s.radius, stroke: false, fillColor: color, fillOpacity: 1, interactive: false }).addTo(layer);
      } else {
        L.circle([s.lat, s.lng], { radius: s.radius, color, weight: 1, opacity: .7, dashArray: '2 5', fillColor: color, fillOpacity: .07, interactive: false }).addTo(layer);
      }
      const mk = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
          html: `<div class="mk struct${s.connected ? '' : ' loose'}${s.broken ? ' broken' : ''}" style="--pc:${color};width:26px;height:26px;font-size:14px"><i class="glyph">${esc(s.glyph)}</i></div>` }),
        zIndexOffset: 100,
      });
      mk.bindPopup(`<h4>${esc(s.glyph)} ${esc(s.name)}</h4>
        <div class="sc" style="color:${color}">${s.connected ? 'połączony z obszarem' : 'stoi osobno — działa tylko w swoim kręgu'}</div>
        <p style="margin:.4em 0">Zasięg ${Math.round(s.radius)} m · wytrzymałość ${s.pct}%${s.broken ? ' — zniszczony!' : ''}</p>
        <button class="btn small" onclick="Game.openSite('${kind}'${kind === 'base' ? ', ' + site.owner_id : ''})">Zarządzaj</button>`);
      mk.addTo(layer);
    }
  },

  // ---------------------------------------------------------------- tropy (strzałki do celu)
  TRAIL_COLORS: { gather: '#8fae4c', explore: '#7ea4ad', hunt: '#c4402c', shop: '#c9a24a', market: '#c9a24a', stall: '#d7802f', search: '#a0804a' },

  setTrail(leads) { this.trail = leads || null; this.drawTrail(); },

  drawTrail() {
    if (this.disabled || !this.layers.trail) return;
    const layer = this.layers.trail;
    layer.clearLayers();
    if (!this.trail || !this.trail.length) return;
    const me = this.me.getLatLng();
    const pMe = this.map.latLngToLayerPoint(me);
    this.trail.forEach((l, i) => {
      const color = this.TRAIL_COLORS[l.type] || '#c9a24a';
      const target = L.latLng(l.lat, l.lng);
      const dist = distM(me.lat, me.lng, l.lat, l.lng);
      const deg = bearingDeg(me.lat, me.lng, l.lat, l.lng);
      const popup = `<h4>${esc(l.glyph || '')} ${esc(l.title)}</h4>
        <div class="sc" style="color:${color}">${esc(l.itemName || '')}</div>
        <p style="margin:.4em 0">${esc(l.detail)}</p>
        <div class="muted">${dist < 30 ? 'Jesteś na miejscu.' : `${fmtDist(dist)} na ${directionName(deg)} · azymut ${Math.round(deg)}°`}${l.place ? ' · ' + esc(l.place) : ''}</div>
        ${l.pct != null ? `<div class="muted">Szansa przy eksploracji tam: ~${l.pct}%</div>` : ''}
        ${l.night ? '<div class="muted">☾ Częściej nocą.</div>' : ''}${l.day_only ? '<div class="muted">☀ Tylko za dnia.</div>' : ''}
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small" onclick="Game.focusLead(${i})">Pokaż cel</button>
          <button class="btn small ghost" onclick="Game.clearTrail()">Zakończ trop</button></div>`;
      if (dist > 25) {
        L.polyline([me, target], { color, weight: 2, opacity: .55, dashArray: '3 9', interactive: false }).addTo(layer);
        const pT = this.map.latLngToLayerPoint(target);
        const ang = Math.atan2(pT.y - pMe.y, pT.x - pMe.x);
        const pixDist = Math.hypot(pT.x - pMe.x, pT.y - pMe.y);
        const r = Math.min(pixDist * 0.85, 58 + (i % 3) * 20);
        const pos = this.map.layerPointToLatLng(L.point(pMe.x + Math.cos(ang) * r, pMe.y + Math.sin(ang) * r));
        L.marker(pos, {
          zIndexOffset: 900,
          icon: L.divIcon({
            className: '', iconSize: [40, 40], iconAnchor: [20, 20],
            html: `<div class="trail-arrow" style="--tc:${color};transform:rotate(${ang}rad)"><svg viewBox="0 0 40 40"><path d="M6 13 L24 13 L24 6 L37 20 L24 34 L24 27 L6 27 Z"/></svg></div>`,
          }),
        }).bindPopup(popup).addTo(layer);
      }
      L.marker(target, {
        icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
          html: `<div class="trail-target" style="--tc:${color}"><i class="glyph">${esc(l.glyph || '◆')}</i></div>` }),
      }).bindPopup(popup).addTo(layer);
    });
  },
};
