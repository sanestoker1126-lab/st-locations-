(function () {
  "use strict";
  const ids = ["master-form", "master-query", "master-country", "master-platform", "master-category", "master-group", "master-state", "master-proof", "master-meta", "master-results", "master-message", "master-rows", "master-pagination", "master-page", "master-previous", "master-next", "master-download", "master-source-date"];
  const countries = { US: "Estados Unidos", CA: "Canadá", PR: "Puerto Rico (territorio de EE. UU.)", MX: "México" };
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const fmt = new Intl.NumberFormat("es-MX");
  const size = 30;
  const text = value => String(value == null ? "" : value);
  const normalized = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
  let mode = "", metadata = {}, records = [], filtered = [], pageRecords = [], resultTotal = 0;
  let page = 1, ready = false, loading = false, stale = false, timer, sequence = 0, controller;
  let loadedQuery = "", retryAction;
  let initialParamsApplied = false, initialNotice = "";
  let toastTimer;
  let publicSource = null, exporting = false, exportController, exportSequence = 0;

  function fullMode() { return mode === "api" || mode === "public"; }
  function publicZipQuery(params) {
    return mode === "public" && ["q", "country", "region", "platform", "category", "group"].every(key => !params.get(key)) && (!params.get("proof") || params.get("proof") === "all");
  }
  function cancelExport() {
    exportSequence += 1;
    if (exportController) exportController.abort();
    exportController = null; exporting = false;
  }

  function node(tag, value, cls) { const n = document.createElement(tag); if (value != null) n.textContent = value; if (cls) n.className = cls; return n; }
  function link(label, value) {
    try {
      const u = new URL(value);
      if (!["http:", "https:"].includes(u.protocol)) return node("span", label);
      const a = node("a", label); a.href = u.href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a;
    } catch { return node("span", label); }
  }

  const modeStatus = node("p"); modeStatus.id = "master-mode"; modeStatus.setAttribute("role", "status");
  ui["master-meta"].before(modeStatus);
  const retryButton = node("button", "Volver a intentar", "outline-button");
  retryButton.id = "master-retry"; retryButton.type = "button"; retryButton.hidden = true;
  ui["master-message"].after(retryButton);
  retryButton.addEventListener("click", () => { if (retryAction) retryAction(); });
  ui["master-rows"].setAttribute("aria-busy", "true");
  const multipleOption = ui["master-proof"].querySelector('option[value="multiple"]');
  if (multipleOption) multipleOption.textContent = "Coincide en 2+ dominios registrados";

  function normalizeRecord(record) {
    const aliases = Array.isArray(record.aliases) ? record.aliases.map(text) : [];
    const rawPhones = Array.isArray(record.phones) ? record.phones : (record.phone_e164 || record.phone ? [{ e164: record.phone_e164 || record.phone, display: record.phone || record.phone_e164 }] : []);
    const phones = rawPhones.filter(p => p && typeof p === "object").map(p => ({
      ...p, e164: text(p.e164), display: text(p.display || p.e164), extension: text(p.extension),
      publications: Array.isArray(p.publications) ? p.publications.filter(pub => pub && typeof pub === "object") : []
    }));
    const r = { ...record, id: text(record.id || record.location_id), name: text(record.name || record.business_name), category: text(record.category || record.business_category), country: text(record.country), state: text(record.state), aliases, phones, provenance: Array.isArray(record.provenance) ? record.provenance.filter(pub => pub && typeof pub === "object") : [] };
    r._search = normalized([r.name, r.address, r.city, r.state, r.postal_code, r.category, ...aliases, ...phones.map(p => p.e164)].join(" "));
    return r;
  }

  function fill(id, values) {
    const select = ui[id], prior = select.value;
    while (select.options.length > 1) select.remove(1);
    for (const value of [...new Set(values.filter(Boolean))].sort((a, b) => text(a).localeCompare(text(b), "es"))) {
      const opt = node("option", value); opt.value = value; select.append(opt);
    }
    if ([...select.options].some(option => option.value === prior)) select.value = prior;
  }

  function regionOptions() {
    const prior = ui["master-state"].value, countryFilter = ui["master-country"].value;
    while (ui["master-state"].options.length > 1) ui["master-state"].remove(1);
    const regions = fullMode() ? (Array.isArray(metadata.regions) ? metadata.regions : []) : [...new Map(records.map(r => [r.country + "|" + r.state, { country: r.country, region: r.state }])).values()];
    const values = [...new Map(regions.filter(r => r && r.region && (!countryFilter || r.country === countryFilter)).map(r => [r.country + "|" + r.region, r])).entries()].sort(([a], [b]) => a.localeCompare(b, "es"));
    for (const [value, region] of values) {
      const opt = node("option", (countries[region.country] || region.country) + " · " + region.region + (region.count != null ? " · " + fmt.format(count(region.count)) : ""));
      opt.value = value; ui["master-state"].append(opt);
    }
    if (values.some(([value]) => value === prior)) ui["master-state"].value = prior;
  }

  function configureOptions() {
    fill("master-category", Object.keys(metadata.categories || {}));
    fill("master-group", Object.keys(metadata.chain_groups || {}));
    const platforms = fullMode() ? Object.keys(metadata.platforms || {}) : [];
    fill("master-platform", platforms);
    ui["master-platform"].disabled = platforms.length === 0;
    document.getElementById("master-platform-field").hidden = platforms.length === 0;
    const prior = ui["master-country"].value;
    while (ui["master-country"].options.length > 1) ui["master-country"].remove(1);
    for (const [code, total] of Object.entries(metadata.countries || {})) {
      const opt = node("option", (countries[code] || code) + " · " + fmt.format(count(total))); opt.value = code; ui["master-country"].append(opt);
    }
    if ([...ui["master-country"].options].some(option => option.value === prior)) ui["master-country"].value = prior;
    regionOptions();
  }

  function applyInitialParams() {
    if (initialParamsApplied) return;
    initialParamsApplied = true;
    const params = new URLSearchParams(window.location.search);
    const selectValue = (id, value) => {
      if (value && [...ui[id].options].some(option => option.value === value)) { ui[id].value = value; return true; }
      return false;
    };
    if (params.has("q")) ui["master-query"].value = params.get("q");
    selectValue("master-country", params.get("country"));
    regionOptions();
    const region = params.get("region"), country = ui["master-country"].value;
    if (region) {
      const candidates = [...ui["master-state"].options].filter(option => option.value === country + "|" + region || (!country && option.value.endsWith("|" + region)));
      if (candidates.length === 1) ui["master-state"].value = candidates[0].value;
    }
    const platform = params.get("platform");
    if (platform && !selectValue("master-platform", platform)) initialNotice = mode === "static" ? " El filtro de plataforma solicitado no está disponible en este archivo estático." : " La plataforma solicitada no figura en el índice de la base; selecciona una fuente disponible.";
  }

  function showMetadata(sourceDate) {
    modeStatus.textContent = (fullMode() ? "Base completa · Todos los registros disponibles para buscar y exportar." : "Vista estática · búsqueda y descarga limitadas al archivo JSON incluido. La base completa requiere el servidor de datos.") + initialNotice;
    modeStatus.dataset.mode = mode;
    ui["master-meta"].textContent = fmt.format(count(metadata.total)) + " ubicaciones · " + fmt.format(count(metadata.unique_phone_numbers)) + " números distintos · " + Object.keys(metadata.categories || {}).length + " categorías";
    for (const [id, value] of [["stat-total", metadata.total], ["stat-phones", metadata.unique_phone_numbers], ["stat-categories", Object.keys(metadata.categories || {}).length]]) {
      const element = document.getElementById(id);
      if (element) element.textContent = fmt.format(count(value));
    }
    for (const badge of document.querySelectorAll("[data-country-count]")) badge.textContent = fmt.format(count(badge.dataset.countryCount ? metadata.countries?.[badge.dataset.countryCount] : metadata.total));
    const notice = document.querySelector(".master-main .evidence-notice");
    if (notice) notice.replaceChildren(node("strong", "Teléfonos con comprobación actual registrada: " + fmt.format(count(metadata.current_verified)) + "."), document.createTextNode(" Un formato válido y una publicación no demuestran que una línea siga activa ni corresponda hoy al negocio. Revisa la evidencia y la fecha de cada registro."));
    ui["master-source-date"].textContent = fullMode() ? "Las fuentes tienen distintas fechas de publicación o consulta, que se muestran en la evidencia de cada registro. Una consulta reciente no acredita vigencia actual del teléfono." : "Fecha declarada por la fuente de esta vista estática: " + (sourceDate || "no informada") + ". Esta fecha no acredita vigencia actual.";
    if (fullMode() && metadata.source_coverage) {
      const coverage = metadata.source_coverage;
      if (coverage.first_observed_at && coverage.last_observed_at) ui["master-source-date"].append(document.createTextNode(" Fechas registradas: " + coverage.first_observed_at + " a " + coverage.last_observed_at + "."));
    }
    for (const a of document.querySelectorAll('a[href="/st-locations-/data/master-contacts.json"]')) a.textContent = "Vista estática JSON";
    if (fullMode()) for (const a of document.querySelectorAll('a[href="/st-locations-/data/master-phone-review.json"]')) a.textContent = "Revisión de números de la vista estática";
  }

  function queryParams() {
    const params = new URLSearchParams();
    const regionValue = ui["master-state"].value;
    const separator = regionValue.indexOf("|");
    const country = ui["master-country"].value || (separator >= 0 ? regionValue.slice(0, separator) : "");
    const values = { q: ui["master-query"].value.trim(), country, region: separator >= 0 ? regionValue.slice(separator + 1) : "", platform: fullMode() ? ui["master-platform"].value : "", category: ui["master-category"].value, group: ui["master-group"].value, proof: ui["master-proof"].value || "all" };
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
    return params;
  }

  function setBusy(value) {
    loading = value;
    ui["master-rows"].setAttribute("aria-busy", text(value));
    ui["master-download"].disabled = value || exporting || stale || !resultTotal;
    ui["master-previous"].disabled = value || stale || page <= 1;
    ui["master-next"].disabled = value || stale || page * size >= resultTotal;
    retryButton.disabled = value;
  }

  function publicationList(publications) {
    const list = node("ul");
    for (const pub of publications) {
      const li = node("li"), sourceId = text(pub.source_id || pub.source || "Fuente registrada");
      li.append(pub.url || pub.source_url ? link(sourceId, pub.url || pub.source_url) : node("span", sourceId));
      const parts = [pub.sheet ? "Hoja " + pub.sheet : "", pub.row ? "fila " + pub.row : "", pub.source_record_id ? "registro " + pub.source_record_id : "", (pub.observed_at || pub.source_date || pub.retrieved_at) ? "Fecha de fuente/consulta: " + (pub.observed_at || pub.source_date || pub.retrieved_at) : "Fecha no informada"].filter(Boolean);
      li.append(node("small", parts.join(" · "))); list.append(li);
    }
    return list;
  }

  function renderRows(rows) {
    ui["master-rows"].replaceChildren();
    for (const r of rows) {
      const tr = node("tr"); tr.dataset.id = r.id;
      const category = node("td");
      const group = node("small", r.chain_group || "Sin grupo identificado");
      if (/^Sin (cadena|grupo)/i.test(group.textContent)) group.className = "group-unspecified";
      category.append(node("strong", r.category || "Sin categoría"), group);
      const business = node("td"); business.append(node("strong", r.name || "Nombre no publicado"), node("p", [r.address, r.city, r.state, r.postal_code, countries[r.country] || r.country].filter(Boolean).join(", ")));
      if (r.name_basis === "source_activity_fallback") business.append(node("small", "Sin nombre comercial publicado; se muestra la actividad registrada."));
      if (r.aliases.length) business.append(node("small", "Alias: " + r.aliases.join("; ")));
      const phones = node("td");
      for (const p of r.phones) {
        const item = node("div", null, "phone-item");
        const a = node("a", p.display || p.e164, "phone-link"), dial = p.e164.replace(/[^+\d]/g, "");
        if (/^\+?\d{6,15}$/.test(dial)) a.href = "tel:" + dial + (p.extension ? ";ext=" + encodeURIComponent(p.extension) : "");
        const copy = node("button", "Copiar", "copy-phone");
        copy.type = "button";
        copy.setAttribute("aria-label", "Copiar teléfono de " + r.name + ": " + p.e164);
        copy.addEventListener("click", async () => {
          const status = document.getElementById("copy-status");
          try {
            await navigator.clipboard.writeText(p.e164 + (p.extension ? " ext. " + p.extension : ""));
            if (status) status.textContent = "Teléfono copiado: " + p.e164;
          } catch {
            if (status) status.textContent = "No se pudo copiar. Selecciona el número y cópialo manualmente.";
          }
          if (status) { clearTimeout(toastTimer); status.hidden = false; toastTimer = setTimeout(() => { status.hidden = true; }, 3500); }
        });
        item.append(a, node("small", p.e164 + (p.extension ? " · ext. " + p.extension : "")), copy);
        phones.append(item);
      }
      if (!r.phones.length) phones.append(node("small", "Sin teléfono publicado"));
      if (r.shared_phone_locations > 1) phones.append(node("small", "Compartido por " + fmt.format(count(r.shared_phone_locations)) + " ubicaciones; revisar"));
      const evidence = node("td");
      evidence.append(node("p", r.phone_current_verified === true ? "Comprobación actual registrada · revisar evidencia" : "Publicado · vigencia actual sin comprobar", "phone-status"), node("small", "Dominios con evidencia registrada: " + count(r.phone_independent_source_count)));
      const details = node("details"); details.append(node("summary", "Fuentes y comprobación"));
      details.append(node("p", r.phone_current_verified === true ? "El registro declara una comprobación actual. Revisa su fecha y evidencia; la vigencia puede cambiar." : "El número se conserva en formato internacional. Su publicación no comprueba que la línea siga activa ni su asociación actual con este negocio."));
      const seen = new Set();
      for (const p of r.phones) {
        if (!p.publications.length) continue;
        details.append(node("strong", p.e164), publicationList(p.publications));
        p.publications.forEach(pub => seen.add(JSON.stringify(pub)));
      }
      const additional = r.provenance.filter(pub => !seen.has(JSON.stringify(pub)));
      if (additional.length) details.append(node("strong", "Otras referencias del registro"), publicationList(additional));
      if (!seen.size && !additional.length) details.append(node("p", "No se adjuntó evidencia detallada a este registro."));
      evidence.append(details); tr.append(category, business, phones, evidence); ui["master-rows"].append(tr);
    }
  }

  function emptyMessage() {
    if (ui["master-proof"].value === "current") return "No hay registros con comprobación actual para estos filtros. Puedes revisar los teléfonos publicados y su evidencia.";
    const country = ui["master-country"].value;
    if (country && !count(metadata.countries?.[country])) return "No hay registros de " + (countries[country] || country) + " en esta vista.";
    return "No hay coincidencias con estos filtros.";
  }

  function render() {
    renderRows(fullMode() ? pageRecords : filtered.slice((page - 1) * size, page * size));
    ui["master-results"].textContent = fmt.format(resultTotal) + " ubicaciones con estos filtros · " + fmt.format(count(metadata.total)) + (fullMode() ? " en total" : " en la vista estática");
    ui["master-download"].textContent = publicZipQuery(queryParams()) ? "Descargar base ZIP" : "↓ Exportar CSV";
    ui["master-message"].textContent = resultTotal ? "" : emptyMessage();
    ui["master-pagination"].hidden = resultTotal <= size;
    ui["master-page"].textContent = "Página " + page + " de " + Math.max(1, Math.ceil(resultTotal / size));
    retryButton.hidden = true; stale = false; setBusy(false);
  }

  async function loadApiPage(targetPage) {
    if (!ready) return;
    cancelExport();
    if (controller) controller.abort();
    controller = new AbortController();
    const request = ++sequence, params = queryParams(), filterQuery = params.toString();
    params.set("page", text(targetPage)); params.set("page_size", text(size));
    retryAction = () => loadApiPage(targetPage);
    retryButton.hidden = true; setBusy(true);
    ui["master-message"].textContent = "Consultando la base completa…" + (pageRecords.length ? " Los registros visibles corresponden a la consulta anterior." : "");
    try {
      let data;
      if (mode === "public") {
        publicSource.onprogress = info => {
          if (request !== sequence || info.operation !== "query") return;
          ui["master-message"].textContent = "Cargando registros públicos… " + fmt.format(count(info.loaded)) + " de " + fmt.format(count(info.total)) + " registros." + (pageRecords.length ? " Los registros visibles corresponden a la consulta anterior." : "");
        };
        data = await publicSource.query(params, { signal: controller.signal });
      } else {
        const response = await fetch("/st-locations-/api/contacts?" + params, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw Error("HTTP " + response.status);
        data = await response.json();
      }
      if (!data || !Array.isArray(data.records) || !Number.isFinite(Number(data.total))) throw Error("Schema");
      if (request !== sequence) return;
      pageRecords = data.records.map(normalizeRecord); resultTotal = count(data.total); page = Math.max(1, count(data.page) || targetPage); loadedQuery = filterQuery;
      render();
    } catch (error) {
      if (request !== sequence || error.name === "AbortError") return;
      stale = true; setBusy(false); retryButton.hidden = false;
      ui["master-message"].textContent = "No se pudo actualizar esta consulta. " + (pageRecords.length ? "Se conservan los resultados de la consulta anterior; no corresponden necesariamente a los filtros actuales." : "Todavía no se han cargado resultados. El total de la base se conserva arriba.") + " Vuelve a intentarlo.";
      if (!pageRecords.length) ui["master-results"].textContent = "Resultados pendientes de carga.";
    }
  }

  function apply() {
    syncFilterIndicators();
    if (!ready) return;
    if (fullMode()) { loadApiPage(1); return; }
    const query = normalized(ui["master-query"].value).trim(), tokens = query.split(/\s+/).filter(Boolean);
    const digits = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, "") : "";
    filtered = records.filter(r => (tokens.every(t => r._search.includes(t)) || (digits.length >= 7 && r.phones.some(p => p.e164.includes(digits)))) && (!ui["master-category"].value || r.category === ui["master-category"].value) && (!ui["master-group"].value || r.chain_group === ui["master-group"].value) && (!ui["master-country"].value || r.country === ui["master-country"].value) && (!ui["master-state"].value || r.country + "|" + r.state === ui["master-state"].value) && (ui["master-proof"].value !== "current" || r.phone_current_verified === true) && (ui["master-proof"].value !== "multiple" || r.phone_independent_source_count >= 2) && (ui["master-proof"].value !== "shared" || r.shared_phone_locations > 1));
    page = 1; resultTotal = filtered.length; render();
  }

  function csvCell(value) { let t = text(value).replace(/\r?\n/g, " "); if (/^[\s\u0000-\u001f]*[=+@-]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; }
  async function download() {
    clearTimeout(timer);
    if (mode === "public") {
      if (!ready || loading || exporting || stale || !resultTotal || loadedQuery !== queryParams().toString()) return;
      const exportQuery = loadedQuery, request = ++exportSequence;
      exportController = new AbortController(); exporting = true; setBusy(loading);
      ui["master-message"].textContent = publicZipQuery(queryParams()) ? "Preparando la descarga de la base completa…" : "Preparando el CSV de todos los resultados filtrados…";
      publicSource.onprogress = info => {
        if (request !== exportSequence || info.operation !== "csv") return;
        ui["master-message"].textContent = "Preparando CSV… " + fmt.format(count(info.loaded)) + " de " + fmt.format(count(info.total)) + " registros.";
      };
      try {
        const result = await publicSource.exportCsv(new URLSearchParams(exportQuery), { signal: exportController.signal });
        if (request !== exportSequence || stale || exportQuery !== queryParams().toString()) return;
        let url, objectUrl = false;
        if (result.blob instanceof Blob) { url = URL.createObjectURL(result.blob); objectUrl = true; }
        else {
          const candidate = new URL(result.url, window.location.href);
          if (candidate.origin !== window.location.origin || !["http:", "https:"].includes(candidate.protocol)) throw Error("Download URL");
          url = candidate.href;
        }
        const a = node("a"); a.href = url; a.download = result.name || "base-contactos-filtrada.csv";
        document.body.append(a); a.click(); a.remove();
        if (objectUrl) setTimeout(() => URL.revokeObjectURL(url), 60000);
        ui["master-message"].textContent = "";
      } catch (error) {
        if (request === exportSequence && error.name !== "AbortError") ui["master-message"].textContent = "No se pudo preparar la descarga. Tus resultados se conservan; vuelve a pulsar el botón de descarga para intentarlo otra vez.";
      } finally {
        if (request === exportSequence) { exporting = false; exportController = null; setBusy(loading); }
      }
      return;
    }
    if (mode === "api") {
      if (!ready || loading || stale || !resultTotal || loadedQuery !== queryParams().toString()) return;
      const a = node("a"); a.href = "/st-locations-/api/contacts/export.csv?" + loadedQuery; a.download = "base-contactos-filtrada.csv"; document.body.append(a); a.click(); a.remove(); return;
    }
    apply(); if (!filtered.length) return;
    const rows = [["ID", "Categoría", "Grupo", "Negocio", "Dirección", "Ciudad", "Estado", "ZIP/código postal", "Teléfonos E164", "Fecha fuente", "Vigencia actual", "Dominios con evidencia", "Fuentes teléfono", "País o territorio"]];
    for (const r of filtered) rows.push([r.id, r.category, r.chain_group, r.name, r.address, r.city, r.state, r.postal_code, r.phones.map(p => p.e164).join("; "), r.contact_observed_at, r.phone_current_verified === true ? "Comprobación registrada; revisar evidencia" : "No comprobada", r.phone_independent_source_count, [...new Set(r.phones.flatMap(p => p.publications.map(v => v.url).filter(Boolean)))].join("; "), r.country]);
    const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = node("a"); a.href = url; a.download = "base-contactos-vista-estatica.csv"; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadStatic() {
    const response = await fetch("/st-locations-/data/master-contacts.json", { cache: "no-cache" });
    if (!response.ok) throw Error("HTTP " + response.status);
    const data = await response.json();
    if (!Array.isArray(data.records)) throw Error("Schema");
    records = data.records.map(normalizeRecord);
    const values = key => Object.fromEntries([...new Set(records.map(r => r[key]).filter(Boolean))].map(value => [value, records.filter(r => r[key] === value).length]));
    metadata = { total: records.length, countries: Object.fromEntries(Object.keys(countries).map(code => [code, records.filter(r => r.country === code).length])), categories: values("category"), chain_groups: values("chain_group"), unique_phone_numbers: data.metadata?.counts?.unique_published_phone_numbers ?? new Set(records.flatMap(r => r.phones.map(p => p.e164))).size, current_verified: records.filter(r => r.phone_current_verified === true).length };
    mode = "static"; configureOptions(); applyInitialParams(); showMetadata(data.metadata?.source_observed_at); ready = true; apply();
  }

  async function initialize() {
    const request = ++sequence;
    cancelExport();
    if (controller) controller.abort();
    controller = new AbortController();
    if (publicSource?.close) publicSource.close();
    publicSource = null;
    ready = false; setBusy(true); retryButton.hidden = true; retryAction = initialize;
    ui["master-message"].textContent = ""; modeStatus.textContent = "Comprobando acceso a la base completa…";
    try {
      const response = await fetch("/st-locations-/api/contacts/meta", { cache: "no-store", signal: controller.signal });
      if (request !== sequence) return;
      if (response.status === 404 || response.status === 503) {
        if (!window.STPublicContacts) {
          if (document.querySelector('script[src*="public-search-client.js"]')) throw Error("Public search client unavailable");
          await loadStatic(); return;
        }
        try {
          const source = await window.STPublicContacts.open("/st-locations-/data/public/manifest.json", { signal: controller.signal });
          if (request !== sequence) { source.close?.(); return; }
          const data = source.metadata;
          if (!data || !Number.isFinite(Number(data.total)) || !data.countries || !data.categories || !data.chain_groups) { source.close?.(); throw Error("Public schema"); }
          publicSource = source; metadata = data; mode = "public";
          configureOptions(); applyInitialParams(); showMetadata(); ready = true; apply(); return;
        } catch (error) {
          if (error.status !== 404) throw error;
          if (request !== sequence) return;
          await loadStatic(); return;
        }
      }
      if (!response.ok) throw Error("HTTP " + response.status);
      const data = await response.json();
      if (!data || !Number.isFinite(Number(data.total)) || !data.countries || !data.categories || !data.chain_groups) throw Error("Schema");
      metadata = data; mode = "api"; configureOptions(); applyInitialParams(); showMetadata(); ready = true; apply();
    } catch (_) {
      if (request !== sequence) return;
      stale = true; setBusy(false); retryButton.hidden = false;
      modeStatus.textContent = "No se pudo determinar la disponibilidad de la base.";
      ui["master-message"].textContent = "No fue posible cargar la base. Vuelve a intentarlo; no se sustituyó por una vista con un conteo diferente.";
      if (!pageRecords.length && !records.length) ui["master-results"].textContent = "Resultados pendientes de carga.";
    }
  }

  ui["master-form"].addEventListener("submit", event => { event.preventDefault(); clearTimeout(timer); apply(); });
  ui["master-form"].addEventListener("reset", () => { clearTimeout(timer); setTimeout(() => { regionOptions(); apply(); }, 0); });
  ui["master-country"].addEventListener("change", () => { clearTimeout(timer); regionOptions(); apply(); });
  ui["master-query"].addEventListener("input", () => {
    clearTimeout(timer);
    cancelExport();
    if (fullMode() && ready) {
      if (controller) controller.abort();
      sequence += 1; stale = true; setBusy(false);
      ui["master-message"].textContent = "Preparando la búsqueda…" + (pageRecords.length ? " Los registros visibles corresponden a la consulta anterior." : "");
    }
    ui["master-download"].disabled = true; timer = setTimeout(apply, 180);
  });
  for (const id of ["master-platform", "master-category", "master-group", "master-state", "master-proof"]) ui[id].addEventListener("change", () => { clearTimeout(timer); apply(); });
  for (const [id, delta] of [["master-previous", -1], ["master-next", 1]]) ui[id].addEventListener("click", () => {
    if (loading || stale || page + delta < 1 || page + delta > Math.ceil(resultTotal / size)) return;
    if (fullMode()) loadApiPage(page + delta); else { page += delta; render(); }
  });
  ui["master-download"].addEventListener("click", download);

  function syncFilterIndicators() {
    const selectedCountry = ui["master-country"].value;
    for (const shortcut of document.querySelectorAll("button[data-country]")) shortcut.setAttribute("aria-pressed", text(shortcut.dataset.country === selectedCountry));
    const selected = ["master-country", "master-platform", "master-category", "master-group", "master-state", "master-proof"].filter(id => ui[id].value && ui[id].value !== "all").length;
    const badge = document.getElementById("active-filter-count");
    if (badge) { badge.textContent = text(selected); badge.hidden = selected === 0; }
  }
  for (const shortcut of document.querySelectorAll("button[data-country]")) shortcut.addEventListener("click", () => {
    if (!ready) return;
    ui["master-country"].value = shortcut.dataset.country;
    ui["master-country"].dispatchEvent(new Event("change"));
  });
  const filterToggle = document.getElementById("master-filter-toggle"), filterFields = document.getElementById("master-filter-fields");
  const mobile = window.matchMedia("(max-width: 760px)");
  let panelOpen = !mobile.matches;
  function syncFilterPanel() {
    if (!filterToggle || !filterFields) return;
    const expanded = !mobile.matches || panelOpen;
    filterFields.hidden = !expanded;
    filterToggle.setAttribute("aria-expanded", text(expanded));
    filterToggle.replaceChildren(document.createTextNode(expanded ? "Ocultar filtros " : "Mostrar filtros "), node("span", expanded ? "⌃" : "⌄"));
  }
  filterToggle?.addEventListener("click", () => { panelOpen = !panelOpen; syncFilterPanel(); });
  mobile.addEventListener("change", () => { panelOpen = !mobile.matches; syncFilterPanel(); });
  syncFilterPanel();

  function setView(view) {
    document.querySelector(".master-scroll")?.classList.toggle("is-card-view", view === "grid");
    for (const name of ["list", "grid"]) document.getElementById("master-view-" + name)?.setAttribute("aria-pressed", text(view === name));
    try { localStorage.setItem("punto-contact-view", view); } catch (_) { /* View works without storage. */ }
  }
  for (const view of ["list", "grid"]) document.getElementById("master-view-" + view)?.addEventListener("click", () => setView(view));
  try { setView(localStorage.getItem("punto-contact-view") === "grid" ? "grid" : "list"); } catch (_) { setView("list"); }
  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); ui["master-query"].focus(); }
  });
  initialize();
})();
