(function () {
  "use strict";

  const PAGE_SIZE = 12;
  const number = new Intl.NumberFormat("es-MX");
  const fields = { q: "query", scope: "scope", state: "state", provider: "provider", category: "category", status: "status" };
  const ui = Object.fromEntries(["search-form", "query", "scope", "state", "provider", "category", "status", "results", "results-summary", "load-state", "pagination", "page-summary", "previous-page", "next-page", "export-csv", "export-status", "dataset-meta", "source-description", "source-notes", "source-date", "priority-description", "priority-state-list", "priority-warning"].map(id => [id, document.getElementById(id)]));
  let records = [];
  let filtered = [];
  let priorityStates = [];
  let priorityRanks = new Map();
  let page = 1;
  let ready = false;
  let inputTimer;

  function string(value) { return value == null ? "" : String(value).trim(); }
  function normalize(value) { return string(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " "); }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function safeURL(value) {
    try {
      const url = new URL(string(value));
      return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch (_) { return null; }
  }
  function externalLink(label, url, className) {
    const href = safeURL(url);
    if (!href) return null;
    const link = element("a", className, label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }
  function providers(record) { return Array.isArray(record.providers) ? record.providers.map(string).filter(Boolean) : []; }
  function values(value) { return Array.isArray(value) ? value.map(string).filter(Boolean) : []; }
  function alternatePhones(record) {
    return [...new Set(values(record.alternate_phones))].filter(phone => phone.replace(/\D/g, "") !== string(record.phone).replace(/\D/g, ""));
  }
  function phoneNode(value) {
    const text = string(value);
    const digits = text.replace(/\D/g, "");
    if (!/^[+\d\s().-]+$/.test(text) || digits.length < 7 || digits.length > 15) return element("span", "", text);
    const link = element("a", "", text);
    link.href = "tel:" + (text.startsWith("+") ? "+" : "") + digits;
    return link;
  }
  function statusLabel(record) { return record.remittance_status === "source_listed" ? "En el listado aportado · vigencia por confirmar" : "Servicio de remesas por confirmar"; }
  function addressText(record) {
    return [string(record.address), [string(record.city), string(record.state), string(record.postal_code)].filter(Boolean).join(", ")].filter(Boolean).join("\n") || "Domicilio pendiente de confirmar";
  }
  function fillSelect(select, values) {
    for (const value of [...new Set(values.map(string).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"))) {
      const option = element("option", "", value);
      option.value = value;
      select.append(option);
    }
  }
  function setQueryFromURL() {
    const params = new URLSearchParams(window.location.search);
    for (const [key, id] of Object.entries(fields)) {
      const value = params.get(key) || (key === "scope" ? (priorityStates.length ? "priority" : "all") : "");
      const control = ui[id];
      if (control.tagName === "INPUT" || [...control.options].some(option => option.value === value)) control.value = value;
    }
    if (ui.state.value && !priorityRanks.has(ui.state.value)) ui.scope.value = "all";
  }
  function saveURL() {
    const url = new URL(window.location.href);
    for (const [key, id] of Object.entries(fields)) {
      const value = ui[id].value.trim();
      if (value && !(key === "scope" && value === "priority")) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  function applyFilters() {
    if (!ready) return;
    if (!priorityStates.length) ui.scope.value = "all";
    const tokens = normalize(ui.query.value).split(" ").filter(Boolean);
    const phoneQuery = /^[+\d\s().-]+$/.test(ui.query.value.trim()) ? ui.query.value.replace(/\D/g, "") : "";
    const scopeRecords = ui.scope.value === "priority" ? records.filter(record => priorityRanks.has(string(record.state))) : records;
    filtered = records.filter(record => (
      (ui.scope.value !== "priority" || priorityRanks.has(string(record.state))) &&
      (tokens.every(token => record._search.includes(token)) || (phoneQuery.length >= 7 && record._phoneSearch.includes(phoneQuery))) &&
      (!ui.state.value || string(record.state) === ui.state.value) &&
      (!ui.provider.value || providers(record).includes(ui.provider.value)) &&
      (!ui.category.value || string(record.category) === ui.category.value) &&
      (!ui.status.value || record.remittance_status === ui.status.value)
    ));
    const scopeLabel = ui.scope.value === "priority" ? " en " + number.format(priorityStates.length) + " estados prioritarios" : " en todo el directorio";
    ui["dataset-meta"].textContent = number.format(scopeRecords.length) + " registros" + scopeLabel + " · " + number.format(records.length) + " en la base completa";
    page = 1;
    saveURL();
    render();
  }
  function buildEvidence(record, body) {
    body.append(element("h4", "", "Origen del registro"));
    if (string(record.inclusion_basis)) body.append(element("p", "", record.inclusion_basis));
    if (values(record.aliases).length) body.append(element("p", "", "Otros nombres en la fuente: " + values(record.aliases).join("; ")));
    if (values(record.city_aliases).length) body.append(element("p", "", "Otras localidades en la fuente: " + values(record.city_aliases).join("; ")));
    const extraPhones = alternatePhones(record);
    if (extraPhones.length) {
      body.append(element("h4", "", "Teléfonos adicionales de la fuente · confirmar vigencia"));
      for (const phone of extraPhones) {
        const line = element("p");
        line.append(phoneNode(phone));
        body.append(line);
      }
    }
    if (string(record.notes)) {
      body.append(element("h4", "", "Nota del archivo aportado"));
      body.append(element("p", "", record.notes));
    }
    const evidence = Array.isArray(record.evidence) ? record.evidence : [];
    if (!evidence.length) body.append(element("p", "", "Sin referencia documental adicional. Revisa el establecimiento antes de usar este registro."));
    const list = element("ul", "evidence-list");
    for (const item of evidence) {
      const row = element("li");
      const label = string(item.source_id) || string(item.source_file) || "Fuente del registro";
      const link = externalLink(label + " ↗", item.url);
      row.append(link || element("span", "", label));
      const location = [string(item.source_file), string(item.sheet), item.row ? "Fila " + item.row : ""].filter(Boolean).join(" · ");
      if (location) row.append(element("span", "source-location", location));
      if (string(item.source_name)) row.append(element("p", "", "Nombre original: " + string(item.source_name)));
      if (string(item.source_address)) row.append(element("p", "", "Dirección original: " + string(item.source_address)));
      if (string(item.provider_location_id)) row.append(element("span", "source-location", "ID de ubicación del proveedor: " + string(item.provider_location_id)));
      if (string(item.detail)) row.append(element("p", "", item.detail));
      if (string(item.observed_at)) row.append(element("span", "source-location", "Fecha de la evidencia: " + string(item.observed_at)));
      list.append(row);
    }
    if (evidence.length) body.append(list);
    body.append(element("h4", "", "Cruzar con otras fuentes"));
    body.append(element("p", "cross-notice", "Estas consultas no son coincidencias verificadas. Compara nombre, domicilio y localidad; un resultado puede corresponder a otro negocio."));
    const query = [record.name, record.address, record.city, record.state, record.postal_code, "USA"].map(string).filter(Boolean).join(" ");
    const encoded = encodeURIComponent(query);
    const links = [
      ["Buscar en Google Maps ↗", "https://www.google.com/maps/search/?api=1&query=" + encoded],
      ["Buscar en OpenStreetMap ↗", "https://www.openstreetmap.org/search?query=" + encoded],
      ["Buscar en Manta ↗", "https://www.manta.com/search?search=" + encodeURIComponent([record.name, record.city, record.state].map(string).filter(Boolean).join(" "))],
      ["Buscar en OpenCorporates ↗", "https://opencorporates.com/companies?q=" + encodeURIComponent(string(record.name))],
      ["Buscar en Facebook ↗", "https://www.facebook.com/search/top?q=" + encodeURIComponent([record.name, record.city, record.state].map(string).filter(Boolean).join(" "))],
      ["Buscar perfiles de Instagram ↗", "https://www.google.com/search?q=" + encodeURIComponent("site:instagram.com " + [record.name, record.city, record.state].map(string).filter(Boolean).join(" "))]
    ];
    const cross = element("div", "cross-search");
    for (const [label, url] of links) cross.append(externalLink(label, url));
    body.append(cross);
  }
  function buildCard(record) {
    const article = element("article", "business-card");
    article.dataset.recordId = string(record.id);
    const main = element("div", "card-main");
    const top = element("div", "card-top");
    top.append(element("span", "category-label", string(record.category) || "Comercio minorista"));
    if (string(record.state)) top.append(element("span", "state-pill", record.state));
    main.append(top, element("h3", "", string(record.name) || "Negocio sin nombre"), element("p", "address", addressText(record)));
    if (string(record.phone)) {
      const contact = element("div", "profiles");
      contact.append(phoneNode(record.phone));
      main.append(element("span", "source-location", "Teléfono publicado en la fuente · confirmar vigencia"), contact);
    }
    const chips = element("div", "provider-list");
    const companies = providers(record);
    for (const company of companies) chips.append(element("span", "provider-chip", company));
    if (!companies.length) chips.append(element("span", "empty-provider", "Compañía de remesas sin identificar"));
    main.append(chips, element("span", "evidence-badge" + (record.remittance_status === "source_listed" ? "" : " pending"), statusLabel(record)));
    const profiles = element("div", "profiles");
    const labels = { website: "Sitio web de la ficha ↗", facebook: "Facebook de la ficha ↗", instagram: "Instagram de la ficha ↗", osm: "Ficha OSM ↗", google_maps: "Ficha Google Maps ↗" };
    for (const [key, label] of Object.entries(labels)) {
      const link = externalLink(label, record.profiles && record.profiles[key]);
      if (link) profiles.append(link);
    }
    if (profiles.childNodes.length) main.append(profiles);
    const details = element("details", "card-details");
    details.append(element("summary", "", "Ver fuentes y cruzar datos"));
    const body = element("div", "detail-content");
    buildEvidence(record, body);
    details.append(body);
    article.append(main, details);
    return article;
  }
  function renderEmpty(title, description, retry) {
    ui["load-state"].replaceChildren(element("span", "", "⌕"), element("h3", "", title), element("p", "", description));
    ui["load-state"].hidden = false;
    if (retry) {
      const button = element("button", "outline-button", "Volver a cargar");
      button.type = "button";
      button.addEventListener("click", load);
      ui["load-state"].append(button);
    }
  }
  function render() {
    ui.results.replaceChildren();
    ui["export-csv"].disabled = filtered.length === 0;
    ui.pagination.hidden = filtered.length <= PAGE_SIZE;
    ui["load-state"].hidden = filtered.length > 0;
    if (!filtered.length) {
      ui["results-summary"].textContent = "0 resultados · " + (ui.scope.value === "priority" ? "Estados prioritarios" : "Directorio completo");
      renderEmpty("No encontramos coincidencias", "Prueba con otro nombre, limpia los filtros o elige «Todo el directorio» para ampliar el alcance geográfico.");
      return;
    }
    const start = (page - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filtered.length);
    ui["results-summary"].textContent = number.format(filtered.length) + (filtered.length === 1 ? " negocio encontrado" : " negocios encontrados") + " · " + (ui.scope.value === "priority" ? "Estados prioritarios" : "Directorio completo") + " · Mostrando " + number.format(start + 1) + "–" + number.format(end);
    const fragment = document.createDocumentFragment();
    for (const record of filtered.slice(start, end)) fragment.append(buildCard(record));
    ui.results.append(fragment);
    ui["page-summary"].textContent = "Página " + number.format(page) + " de " + number.format(Math.ceil(filtered.length / PAGE_SIZE));
    ui["previous-page"].disabled = page === 1;
    ui["next-page"].disabled = end >= filtered.length;
  }
  function csvValue(value) {
    let cell = string(value).replace(/\r?\n/g, " ");
    if (/^[\s]*[=+\-@]/.test(cell) || /^[\t\r]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  function exportCSV() {
    clearTimeout(inputTimer);
    applyFilters();
    if (!filtered.length) return;
    const columns = ["ID", "Negocio", "Dirección", "Ciudad", "Estado", "Código postal", "País", "Tipo", "Compañías de remesas", "Evidencia de remesas", "Criterio de inclusión", "Fechas de evidencia", "Referencias", "Teléfono publicado", "Teléfonos alternativos publicados", "Nombres alternativos en fuente", "Localidades alternativas en fuente", "Nota del archivo aportado"];
    const rows = filtered.map(record => [record.id, record.name, record.address, record.city, record.state, record.postal_code, record.country, record.category, providers(record).join("; "), statusLabel(record), record.inclusion_basis, [...new Set((record.evidence || []).map(item => item.observed_at).filter(Boolean))].join("; "), (Array.isArray(record.evidence) ? record.evidence : []).map(item => [item.source_file, item.sheet, item.row ? "fila " + item.row : "", safeURL(item.url)].filter(Boolean).join(" · ")).join(" | "), record.phone, alternatePhones(record).join("; "), values(record.aliases).join("; "), values(record.city_aliases).join("; "), record.notes]);
    const csv = "\uFEFF" + [columns, ...rows].map(row => row.map(csvValue).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = element("a");
    link.href = url;
    link.download = "negocios-remesas-filtrados.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui["export-status"].textContent = "Se descargaron " + number.format(filtered.length) + " registros con los filtros actuales.";
  }
  async function load() {
    ready = false;
    ui["export-csv"].disabled = true;
    ui["results-summary"].textContent = "Preparando los registros…";
    renderEmpty("Cargando los negocios…", "Estamos preparando el directorio y sus fuentes.");
    try {
      const [response, priorityConfig] = await Promise.all([
        fetch("/st-locations-/data/locations.json"),
        fetch("/st-locations-/data/state-priorities.json").then(result => {
          if (!result.ok) throw new Error("Prioridades no disponibles");
          return result.json();
        }).catch(() => null)
      ]);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!data || !Array.isArray(data.records)) throw new Error("Formato de datos inválido");
      const states = priorityConfig && Array.isArray(priorityConfig.states) ? priorityConfig.states : [];
      const validPriorities = states.length > 0 && states.every(state => state && /^[A-Z]{2}$/.test(string(state.code)) && string(state.name) && Number.isFinite(state.priority)) && new Set(states.map(state => state.code)).size === states.length;
      priorityStates = validPriorities ? [...states].sort((a, b) => a.priority - b.priority) : [];
      priorityRanks = new Map(priorityStates.map((state, index) => [state.code, index]));
      ui.scope.querySelector('option[value="priority"]').disabled = !priorityStates.length;
      ui["priority-warning"].hidden = priorityStates.length > 0;
      ui["priority-warning"].textContent = priorityStates.length ? "" : "No pudimos cargar la selección de estados prioritarios. Puedes consultar todo el directorio y filtrar por estado.";
      const priorityReference = (string(priorityConfig && priorityConfig.reference) || "Selección operativa; no es un ranking actualizado").replace(/[.!?]+$/, "") + ".";
      ui["priority-description"].textContent = priorityStates.length ? (priorityConfig.criterion === "user_selected_states" ? priorityReference : "Enfoque por número total de residentes latinos, no por porcentaje. " + priorityReference) : "El alcance geográfico está disponible por estado mientras se restablece la selección prioritaria.";
      ui["priority-state-list"].replaceChildren();
      for (const state of priorityStates) {
        const chip = element("button", "priority-state", state.name);
        chip.type = "button";
        chip.addEventListener("click", () => { ui.scope.value = "priority"; ui.state.value = state.code; applyFilters(); });
        ui["priority-state-list"].append(chip);
      }
      records = data.records.filter(record => record && typeof record === "object").map(record => ({ ...record, _search: normalize([record.name, ...values(record.aliases), record.address, record.city, ...values(record.city_aliases), record.state, record.postal_code, record.phone, ...alternatePhones(record), record.category, ...providers(record)].map(string).join(" ")), _phoneSearch: [record.phone, ...alternatePhones(record)].map(phone => string(phone).replace(/\D/g, "")).filter(Boolean).join(" ") }));
      records.sort((a, b) => (priorityRanks.get(string(a.state)) ?? Number.MAX_SAFE_INTEGER) - (priorityRanks.get(string(b.state)) ?? Number.MAX_SAFE_INTEGER) || string(a.city).localeCompare(string(b.city), "es") || string(a.name).localeCompare(string(b.name), "es"));
      for (const id of ["state", "provider", "category"]) while (ui[id].options.length > 1) ui[id].remove(1);
      fillSelect(ui.state, records.map(record => record.state));
      fillSelect(ui.provider, records.flatMap(providers));
      fillSelect(ui.category, records.map(record => record.category));
      const metadata = data.metadata || {};
      ui["source-description"].textContent = string(metadata.description) || "La base conserva las referencias originales de cada registro.";
      ui["source-notes"].replaceChildren();
      for (const note of Array.isArray(metadata.source_notes) ? metadata.source_notes : []) {
        const text = typeof note === "string" ? note : [note.title, note.detail, note.description].map(string).filter(Boolean).join(": ");
        if (text) ui["source-notes"].append(element("li", "", text));
      }
      ui["source-date"].textContent = string(metadata.updated_at) ? "Preparación de la base: " + metadata.updated_at + ". Esta fecha no acredita la vigencia de cada negocio." : "Sin fecha de actualización declarada.";
      setQueryFromURL();
      ready = true;
      applyFilters();
    } catch (_) {
      ui.results.replaceChildren();
      ui.pagination.hidden = true;
      ui["dataset-meta"].textContent = "Directorio no disponible temporalmente";
      ui["results-summary"].textContent = "No fue posible cargar los registros";
      renderEmpty("No pudimos cargar el directorio", "Comprueba tu conexión y vuelve a intentarlo en unos momentos.", true);
    }
  }
  ui["search-form"].addEventListener("submit", event => { event.preventDefault(); clearTimeout(inputTimer); applyFilters(); });
  ui.query.addEventListener("input", () => { clearTimeout(inputTimer); inputTimer = setTimeout(applyFilters, 150); });
  for (const id of ["provider", "category", "status"]) ui[id].addEventListener("change", applyFilters);
  ui.state.addEventListener("change", () => { if (ui.state.value && !priorityRanks.has(ui.state.value)) ui.scope.value = "all"; applyFilters(); });
  ui.scope.addEventListener("change", () => { if (ui.scope.value === "priority" && ui.state.value && !priorityRanks.has(ui.state.value)) ui.state.value = ""; applyFilters(); });
  ui["search-form"].addEventListener("reset", () => { clearTimeout(inputTimer); setTimeout(applyFilters, 0); ui["export-status"].textContent = ""; });
  for (const [id, direction] of [["previous-page", -1], ["next-page", 1]]) ui[id].addEventListener("click", () => {
    const target = page + direction;
    if (target < 1 || target > Math.ceil(filtered.length / PAGE_SIZE)) return;
    page = target;
    render();
    ui["results-summary"].scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  ui["export-csv"].addEventListener("click", exportCSV);
  window.addEventListener("popstate", () => { if (ready) { setQueryFromURL(); applyFilters(); } });
  load();
})();
