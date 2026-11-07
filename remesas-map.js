/* Punto Envíos: minimapa. Sin coordenadas inventadas ni geocodificación masiva. */
(() => {
  "use strict";
  const base = new URL("./", document.currentScript.src);
  const $ = id => document.getElementById(id);
  const ui = { panel: $("remesas-map-panel"), canvas: $("remesas-map"), message: $("remesas-map-message"),
    status: $("remesas-map-status"), expand: $("remesas-map-expand"), nearby: $("remesas-map-nearby"),
    results: $("results") };
  if (!ui.panel || !ui.canvas || !ui.results) return;

  const locations = new Map();
  let currentRecords = new Map();
  let filteredIds = new Set();
  let map, layer, me, geocoding = false, lastRequest = 0;
  const number = new Intl.NumberFormat("es-MX");
  const clean = value => String(value ?? "").trim();
  const coordsValid = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
    Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180;
  const label = row => [row.name, row.address, row.city, row.state, row.postal_code].map(clean).filter(Boolean).join(", ");
  function say(message, link) {
    ui.message.replaceChildren(document.createTextNode(message));
    if (link) {
      const a = document.createElement("a");
      a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(link);
      a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "Buscar dirección en Google Maps ↗";
      ui.message.append(document.createTextNode(" "), a);
    }
  }
  function showCount() {
    const selected = [...locations.values()].filter(point => filteredIds.has(point.id));
    const validated = selected.filter(point => point.precision === "address" && point.verified_at).length;
    ui.status.textContent = selected.length ?
      number.format(selected.length) + " punto(s) visibles · " + validated + " validados" :
      "Sin coordenadas verificadas para estos filtros";
    if (!selected.length) say("El directorio no incluye coordenadas originales. Usa «Ubicar en minimapa» en una ficha para consultar su dirección, sin asignar una ubicación ficticia.");
    else say("Puntos mostrados: verde = coordenada validada; ámbar = búsqueda automática no verificada.");
  }
  function popup(point) {
    const div = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = clean(currentRecords.get(point.id)?.name) || point.id;
    const p = document.createElement("p");
    p.textContent = point.precision === "address" && point.verified_at ?
      "Coordenada de dirección validada (" + point.verified_at + ")." :
      "Dirección geocodificada automáticamente; ubicación pendiente de verificación.";
    const a = document.createElement("a");
    a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(label(currentRecords.get(point.id) || {}));
    a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "Contrastar ubicación ↗";
    div.append(strong, p, a);
    return div;
  }
  function draw() {
    if (!map || !layer) return;
    layer.clearLayers();
    const points = [...locations.values()].filter(point => filteredIds.has(point.id));
    const zoom = map.getZoom(), groups = new Map();
    for (const point of points) {
      const xy = map.project([point.lat, point.lng], zoom);
      const key = zoom >= 16 ? point.id : Math.floor(xy.x / 58) + ":" + Math.floor(xy.y / 58);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
    }
    for (const pointsInCell of groups.values()) {
      const lat = pointsInCell.reduce((sum, p) => sum + p.lat, 0) / pointsInCell.length;
      const lng = pointsInCell.reduce((sum, p) => sum + p.lng, 0) / pointsInCell.length;
      if (pointsInCell.length === 1) {
        const item = pointsInCell[0];
        const verified = item.precision === "address" && item.verified_at;
        const icon = L.divIcon({ className: "remesas-marker " + (verified ? "is-verified" : "is-pending"),
          html: '<span aria-hidden="true">⌖</span>', iconSize: [36, 36], iconAnchor: [18, 18] });
        L.marker([lat, lng], { icon, title: clean(currentRecords.get(item.id)?.name) || "Negocio" })
          .bindPopup(popup(item)).addTo(layer);
      } else {
        const icon = L.divIcon({ className: "remesas-cluster",
          html: "<span>" + pointsInCell.length + "</span>", iconSize: [46, 46], iconAnchor: [23, 23] });
        const marker = L.marker([lat, lng], { icon, title: pointsInCell.length + " puntos agrupados" });
        marker.on("click", () => {
          const bounds = L.latLngBounds(pointsInCell.map(p => [p.lat, p.lng]));
          if (bounds.getNorthEast().equals(bounds.getSouthWest())) map.setView([lat, lng], Math.min(19, map.getZoom() + 2));
          else map.fitBounds(bounds.pad(.5), { maxZoom: 17 });
        });
        marker.addTo(layer);
      }
    }
    showCount();
  }
  function focus(point) {
    if (!map) return;
    if (ui.panel.classList.contains("is-expanded") === false && window.innerWidth < 740) setExpanded(true);
    map.invalidateSize();
    map.setView([point.lat, point.lng], 16, { animate: true });
    draw();
    ui.panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    const marker = layer.getLayers().find(m => m.getLatLng &&
      Math.abs(m.getLatLng().lat - point.lat) < .000001 && Math.abs(m.getLatLng().lng - point.lng) < .000001);
    marker?.openPopup?.();
  }
  function setExpanded(expanded) {
    ui.panel.classList.toggle("is-expanded", expanded);
    ui.expand.setAttribute("aria-expanded", String(expanded));
    ui.expand.textContent = expanded ? "Contraer mapa ↙" : "Ampliar mapa ↗";
    setTimeout(() => map?.invalidateSize(), 60);
  }
  function matchAddress(row, candidate) {
    const address = candidate.address || {};
    const numberInStreet = clean(row.address).match(/\b\d{1,6}[A-Za-z]?\b/);
    const expectedZip = clean(row.postal_code).match(/\d{5}/)?.[0];
    const foundZip = clean(address.postcode).match(/\d{5}/)?.[0];
    const foundNumber = clean(address.house_number).toUpperCase();
    if (!numberInStreet || !expectedZip || !foundZip || expectedZip !== foundZip) return false;
    if (foundNumber && foundNumber !== numberInStreet[0].toUpperCase()) return false;
    if (!foundNumber && !new RegExp("\\b" + numberInStreet[0] + "\\b").test(clean(candidate.display_name))) return false;
    const state = clean(row.state).toUpperCase();
    if (state && state.length === 2 && clean(address.country_code).toLowerCase() !== "us") return false;
    return coordsValid(candidate.lat, candidate.lon);
  }
  async function locate(row) {
    if (!row || geocoding) return;
    const cached = locations.get(clean(row.id));
    if (cached) { focus(cached); return; }
    if (!clean(row.address) || !clean(row.postal_code)) {
      say("Esta ficha no tiene dirección y código postal suficientes para ubicarla con seguridad.", label(row)); return;
    }
    geocoding = true;
    say("Consultando una coincidencia de dirección. No se geocodifican negocios automáticamente.");
    try {
      const pause = Math.max(0, 1200 - (Date.now() - lastRequest));
      if (pause) await new Promise(resolve => setTimeout(resolve, pause));
      lastRequest = Date.now();
      const query = [row.address, row.city, row.state, row.postal_code, "United States"].filter(Boolean).join(", ");
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.search = new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", limit: "5", countrycodes: "us" }).toString();
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, referrerPolicy: "strict-origin-when-cross-origin" });
      if (!response.ok) throw new Error("Geocodificación temporalmente no disponible.");
      const candidates = await response.json();
      const found = (Array.isArray(candidates) ? candidates : []).find(candidate => matchAddress(row, candidate));
      if (!found) {
        say("No encontramos una coincidencia suficientemente precisa con número de calle y ZIP. No añadimos ningún marcador.", label(row)); return;
      }
      const point = { id: clean(row.id), lat: Number(found.lat), lng: Number(found.lon),
        precision: "estimated", source: "nominatim_user_lookup", verified_at: null };
      locations.set(point.id, point);
      draw(); focus(point);
      say("Punto estimado a partir de la dirección. Debes contrastarlo antes de usarlo.", label(row));
    } catch (error) {
      say("No fue posible consultar esta dirección. Puedes contrastarla en un servicio de mapas.", label(row));
    } finally { geocoding = false; }
  }
  function init() {
    if (!window.L) {
      ui.status.textContent = "El visor no está disponible";
      say("No se cargó el mapa interactivo. El directorio sigue funcionando y puedes abrir la búsqueda externa desde las fichas.");
      return;
    }
    map = L.map(ui.canvas, { zoomControl: false, scrollWheelZoom: false, minZoom: 3, maxZoom: 19 })
      .setView([39.8, -98.5], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on("zoomend", draw);
    draw();
  }
  async function loadVerified() {
    try {
      const response = await fetch(new URL("data/remesas-geopoints.json", base), { cache: "no-cache" });
      if (!response.ok) return;
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.points)) return;
      for (const p of data.points) {
        if (!clean(p.id) || !coordsValid(p.lat, p.lng) || p.precision !== "address" || !p.verified_at) continue;
        locations.set(clean(p.id), { id: clean(p.id), lat: Number(p.lat), lng: Number(p.lng),
          precision: "address", source: clean(p.source), verified_at: clean(p.verified_at) });
      }
      draw();
    } catch (_) { /* Base de puntos opcional; directorio disponible sin ella. */ }
  }
  window.addEventListener("remesas:results", event => {
    const rows = Array.isArray(event.detail?.records) ? event.detail.records : [];
    currentRecords = new Map(rows.map(row => [clean(row.id), row]));
    filteredIds = new Set(currentRecords.keys());
    draw();
  });
  ui.results.addEventListener("click", event => {
    const button = event.target.closest("button[data-map-locate]");
    if (!button) return;
    const row = currentRecords.get(button.dataset.mapLocate);
    if (row) locate(row);
  });
  ui.expand.addEventListener("click", () => setExpanded(!ui.panel.classList.contains("is-expanded")));
  ui.nearby.addEventListener("click", () => {
    if (!map) return;
    if (!navigator.geolocation) { say("Tu navegador no ofrece geolocalización."); return; }
    say("Solicitando permiso de ubicación al navegador. No almacenamos tu posición.");
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      if (!coordsValid(lat, lng)) return;
      if (me) map.removeLayer(me);
      me = L.circleMarker([lat, lng], { radius: 8, weight: 3, color: "#ffffff", fillColor: "#5ca4ff", fillOpacity: .85 })
        .bindPopup("Tu posición aproximada; no es la dirección de un negocio.").addTo(map);
      map.setView([lat, lng], 11);
      say("Mapa centrado en tu posición. Los puntos de comercios siguen sujetos a verificación.");
    }, () => say("No se concedió acceso a la ubicación. Puedes seguir usando la búsqueda por estado o ciudad."),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 });
  });
  init();
  loadVerified();
})();
