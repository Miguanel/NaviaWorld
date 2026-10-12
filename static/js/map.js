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
    for (const k of ['zones', 'power', 'buildings', 'camps', 'bases', 'players']) {
      this.layers[k] = L.layerGroup().addTo(this.map);
    }
    this.me = L.marker([lat, lng], {
      icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000, interactive: false,
    }).addTo(this.map);
    this.meRange = L.circle([lat, lng], { radius: 70, color: '#d7802f', weight: 1, opacity: .4, fillOpacity: .03, dashArray: '2 6', interactive: false }).addTo(this.map);
    this.map.on('dragstart', () => { this.follow = false; });
    this.map.on('click', e => Game.onMapClick(e.latlng));
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
    Object.values(this.layers).forEach(l => l.clearLayers());

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
      const m = L.marker([cp.lat, cp.lng], {
        icon: this.icon('🔥', 'camp', 34, `${cp.owner}${cp.own ? ' (twój)' : ''}`), opacity: .3 + .7 * Math.max(0, cp.fade),
      }).bindPopup(`<h4>${esc(cp.name)}</h4><div class="muted">Rozpalił: ${esc(cp.owner)}</div>
        <p style="margin:.4em 0">Ogień dogaśnie za ${cp.left_h} h. Konstrukcji: ${cp.structures}.</p>`);
      m.addTo(this.layers.camps);
    }

    for (const b of w.bases) {
      const list = (b.structures || []).map(s => `${s.glyph} ${esc(s.name)} — ${s.pct}%`).join('<br>') || 'Pusto. Postaw coś z torby.';
      L.marker([b.lat, b.lng], { icon: this.icon('🏚️', 'base', 36, b.own ? 'Twoje siedlisko' : `Siedlisko ${b.owner_name}`) })
        .bindPopup(`<h4>${b.own ? 'Twoje siedlisko' : 'Siedlisko ' + esc(b.owner_name)}</h4><div class="muted" style="margin-bottom:6px">Widoczne tylko dla zaproszonych.</div>${list}`)
        .addTo(this.layers.bases);
      L.circle([b.lat, b.lng], { radius: Game.cfg.camp_radius, color: '#7ea4ad', weight: 1, dashArray: '3 5', fillOpacity: .04, interactive: false }).addTo(this.layers.bases);
    }

    for (const p of w.players) {
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div class="other-marker"></div><span class="mk-label" style="top:16px">${esc(p.name)} · ${p.level}</span>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
      }).addTo(this.layers.players);
    }
  },
};
