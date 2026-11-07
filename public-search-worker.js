/* Full public catalogue search. Data stays in a worker; at most two shards are retained. */
(function (scope) {
  "use strict";
  const CSV_HEADER = ["ID", "Categoría", "Grupo", "Negocio", "Dirección", "Ciudad", "Estado", "ZIP/código postal", "Teléfonos E164", "Fecha fuente", "Vigencia actual", "Dominios coincidentes en fuentes", "Fuentes teléfono", "País o territorio"];
  const REQUIRED = ["id", "country", "state", "city", "name", "address", "postal_code", "category", "chain_group", "phones", "platforms", "phone_independent_source_count", "phone_current_verified", "shared_phone_locations"];
  const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ");
  const abortError = () => Object.assign(new Error("Consulta cancelada."), { name: "AbortError" });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const asCount = value => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

  function paramsOf(entries) {
    const raw = Object.create(null);
    const pairs = Array.isArray(entries) ? entries : Object.entries(entries || {});
    if (pairs.length > 20) throw new Error("Demasiados parámetros de búsqueda.");
    for (const [key, value] of pairs) {
      if (Object.hasOwn(raw, key)) throw new Error("Cada filtro debe aparecer una sola vez.");
      raw[key] = value;
    }
    const result = Object.create(null);
    for (const key of ["q", "country", "region", "category", "group", "proof", "platform"]) {
      const value = raw[key] ?? "";
      if (typeof value !== "string") throw new Error("Cada filtro debe ser texto.");
      result[key] = value.trim();
      if (result[key].length > (key === "q" ? 300 : 256) || /[\u0000-\u001f]/.test(result[key])) throw new Error("El filtro contiene texto demasiado largo o caracteres de control.");
    }
    result.country = result.country.toUpperCase();
    if (result.country && !["US", "CA", "PR", "MX"].includes(result.country)) throw new Error("País no admitido; usa US, CA, PR o MX.");
    result.proof ||= "all";
    if (!["all", "multiple", "current", "shared"].includes(result.proof)) throw new Error("Filtro de comprobación no admitido.");
    result.tokens = normalize(result.q).split(/\s+/).filter(Boolean);
    if (result.q && !result.tokens.length) throw new Error("La búsqueda debe contener texto o números.");
    result.digits = /^[+\d\s().-]+$/.test(result.q) ? result.q.replace(/\D/g, "") : "";
    if (result.digits.length < 7) result.digits = "";
    for (const [key, fallback] of [["page", 1], ["page_size", 30]]) {
      const value = String(raw[key] ?? fallback);
      if (!/^[0-9]{1,9}$/.test(value) || Number(value) < 1) throw new Error("La página y su tamaño deben ser enteros positivos.");
      result[key] = Number(value);
    }
    if (result.page_size > 200) throw new Error("El tamaño de página máximo es 200.");
    return result;
  }

  function csvCell(value) {
    let text = String(value ?? "").replace(/[\r\n]/g, " ");
    if (/^[ \t\ufeff]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  const csvLine = values => values.map(csvCell).join(",") + "\r\n";

  class PublicEngine {
    constructor(manifest, rootURL, options = {}) {
      if (!manifest || manifest.version !== 1 || !manifest.metadata || !Array.isArray(manifest.fields) || !Array.isArray(manifest.shards)) throw new Error("El índice público tiene un formato no admitido.");
      this.manifest = manifest;
      this.metadata = manifest.metadata;
      this.fields = manifest.fields;
      this.index = Object.fromEntries(this.fields.map((field, index) => [field, index]));
      if (!REQUIRED.every(field => Object.hasOwn(this.index, field))) throw new Error("Faltan campos del catálogo público.");
      const total = asCount(manifest.total);
      if (total === null || total !== asCount(this.metadata.total) || manifest.shards.reduce((sum, shard) => sum + (asCount(shard.count) ?? NaN), 0) !== total) throw new Error("Los conteos del índice público no coinciden.");
      this.rootURL = new URL(rootURL);
      this.fetch = options.fetch || scope.fetch.bind(scope);
      this.verifyHash = options.verifyHash !== false;
      this.cache = new Map();
    }
    check(job) {
      if (job?.signal?.aborted || (job?.isCurrent && !job.isCurrent())) throw abortError();
    }
    shardMatches(shard, params) {
      if (params.country && shard.country && shard.country !== params.country) return false;
      if (params.country && Array.isArray(shard.countries) && !shard.countries.includes(params.country)) return false;
      if (params.region && shard.state && shard.state !== params.region) return false;
      if (params.region && Array.isArray(shard.regions) && !shard.regions.some(region => (region.state || region.region) === params.region && (!params.country || region.country === params.country))) return false;
      return true;
    }
    async shard(descriptor, job) {
      this.check(job);
      const gzip = Boolean(descriptor.gzip_url && typeof scope.DecompressionStream === "function");
      const url = new URL((gzip ? descriptor.gzip_url : descriptor.url).replace(/^\/+/, ""), this.rootURL);
      if (url.origin !== this.rootURL.origin || !url.href.startsWith(this.rootURL.href)) throw new Error("Ruta de datos fuera del catálogo público.");
      if (this.cache.has(url.href)) {
        const value = this.cache.get(url.href);
        this.cache.delete(url.href); this.cache.set(url.href, value);
        return value;
      }
      const response = await this.fetch(url.href, { signal: job?.signal, cache: "force-cache" });
      if (!response.ok) throw new Error("No se pudo cargar un lote del catálogo (HTTP " + response.status + "). Vuelve a intentarlo.");
      let bytes = await response.arrayBuffer();
      // Some CDNs declare Content-Encoding themselves. Fetch then returns the
      // decompressed JSON already, so check the magic bytes before decoding.
      const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
      if (gzip && signature[0] === 0x1f && signature[1] === 0x8b) {
        bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new scope.DecompressionStream("gzip"))).arrayBuffer();
      }
      this.check(job);
      if (this.verifyHash && descriptor.sha256) {
        if (!scope.crypto?.subtle) throw new Error("El navegador no permite verificar los datos. Abre el sitio mediante HTTPS.");
        const hash = [...new Uint8Array(await scope.crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
        if (hash !== descriptor.sha256.toLowerCase()) throw new Error("Un lote no coincide con la versión publicada. Recarga y vuelve a intentarlo.");
      }
      const data = JSON.parse(new TextDecoder().decode(bytes));
      this.check(job);
      if (!Array.isArray(data.rows) || data.rows.length !== descriptor.count || JSON.stringify(data.fields) !== JSON.stringify(this.fields)) throw new Error("Un lote del catálogo está incompleto o usa campos incompatibles.");
      if (data.rows.some(row => !Array.isArray(row) || row.length !== this.fields.length)) throw new Error("Un registro del catálogo está incompleto.");
      this.cache.set(url.href, data.rows);
      while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value);
      return data.rows;
    }
    record(row) {
      return Object.fromEntries(this.fields.map((field, index) => [field, row[index]]));
    }
    matches(row, params) {
      const ix = this.index;
      for (const [param, field] of [["country", "country"], ["region", "state"], ["category", "category"], ["group", "chain_group"]]) if (params[param] && row[ix[field]] !== params[param]) return false;
      if (params.platform && !(row[ix.platforms] || []).includes(params.platform)) return false;
      if (params.proof === "multiple" && Number(row[ix.phone_independent_source_count]) < 2) return false;
      if (params.proof === "current" && !row[ix.phone_current_verified]) return false;
      if (params.proof === "shared" && Number(row[ix.shared_phone_locations]) <= 1) return false;
      if (!params.tokens.length) return true;
      const phones = row[ix.phones] || [];
      if (params.digits && phones.some(phone => String(phone.e164 || "").includes(params.digits))) return true;
      const aliases = Object.hasOwn(ix, "aliases") && Array.isArray(row[ix.aliases]) ? row[ix.aliases] : [];
      const haystack = normalize([...["name", "address", "city", "state", "postal_code", "category", "id"].map(field => row[ix[field]] || ""), ...aliases].join(" "));
      const phoneText = phones.map(phone => normalize((phone.e164 || "") + " " + (phone.display || "")));
      return params.tokens.every(token => haystack.includes(token) || phoneText.some(value => value.includes(token)));
    }
    unfiltered(params) {
      return !params.q && !params.country && !params.region && !params.category && !params.group && !params.platform && params.proof === "all";
    }
    knownTotal(params) {
      if (params.proof === "current" && this.metadata.current_verified === 0) return 0;
      if (params.q || params.proof !== "all") return null;
      const active = ["country", "region", "category", "group", "platform"].filter(key => params[key]);
      if (!active.length) return this.metadata.total;
      if (active.every(key => key === "country" || key === "region")) {
        if (!params.region) return this.metadata.countries?.[params.country] ?? 0;
        return (this.metadata.regions || []).filter(region => (region.region || region.state) === params.region && (!params.country || region.country === params.country)).reduce((sum, region) => sum + Number(region.count || 0), 0);
      }
      if (active.length === 1) {
        const key = active[0], map = { category: "categories", group: "chain_groups", platform: "platforms" }[key];
        if (map) return this.metadata[map]?.[params[key]] ?? 0;
      }
      return null;
    }
    async query(entries, job = {}) {
      const params = paramsOf(entries), records = [], offset = (params.page - 1) * params.page_size;
      const known = this.knownTotal(params);
      if (known === 0 || (known !== null && offset >= known)) return { records, total: known, page: params.page, page_size: params.page_size };
      let matched = 0, processed = 0;
      for (const descriptor of this.manifest.shards) {
        this.check(job);
        if (!this.shardMatches(descriptor, params)) { processed += descriptor.count; continue; }
        // The opening view and page navigation use the index rather than scanning all data.
        if (this.unfiltered(params) && matched + descriptor.count <= offset) { matched += descriptor.count; processed += descriptor.count; continue; }
        const rows = await this.shard(descriptor, job);
        for (let index = 0; index < rows.length; index += 1) {
          if (index && index % 2000 === 0) { await tick(); this.check(job); }
          const row = rows[index];
          if (!this.matches(row, params)) continue;
          if (matched >= offset && records.length < params.page_size) records.push(this.record(row));
          matched += 1;
          if (known !== null && records.length === params.page_size) return { records, total: known, page: params.page, page_size: params.page_size };
        }
        processed += descriptor.count;
        job.onProgress?.({ loaded: processed, total: this.manifest.total, operation: "query" });
      }
      this.check(job);
      if (known !== null && matched !== known) throw new Error("Los registros cargados no coinciden con el índice público. Recarga la página.");
      return { records, total: matched, page: params.page, page_size: params.page_size };
    }
    async csv(entries, job = {}) {
      const params = paramsOf(entries);
      const pieces = ["\ufeff" + csvLine(CSV_HEADER)];
      let batch = "", count = 0, processed = 0;
      for (const descriptor of this.manifest.shards) {
        this.check(job);
        if (!this.shardMatches(descriptor, params)) { processed += descriptor.count; continue; }
        const rows = await this.shard(descriptor, job);
        for (let index = 0; index < rows.length; index += 1) {
          if (index && index % 2000 === 0) { await tick(); this.check(job); }
          if (!this.matches(rows[index], params)) continue;
          const r = this.record(rows[index]), phones = r.phones || [];
          const urls = [...new Set(phones.flatMap(phone => (phone.publications || []).map(pub => pub.url).filter(Boolean)))].sort();
          batch += csvLine([r.id, r.category, r.chain_group, r.name, r.address, r.city, r.state, r.postal_code, phones.map(phone => phone.e164 + (phone.extension ? " ext. " + phone.extension : "")).join("; "), r.contact_observed_at, "No comprobada", r.phone_independent_source_count, urls.join("; "), r.country]);
          count += 1;
          if (count % 500 === 0) { pieces.push(batch); batch = ""; }
        }
        processed += descriptor.count;
        job.onProgress?.({ loaded: processed, total: this.manifest.total, operation: "csv" });
      }
      if (batch) pieces.push(batch);
      this.check(job);
      return { blob: new Blob(pieces, { type: "text/csv;charset=utf-8" }), name: "st-locations-contactos-filtrados.csv", records: count };
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { PublicEngine, paramsOf, normalize, csvCell };
  if (typeof scope.postMessage !== "function" || typeof scope.document !== "undefined") return;
  let engine, active;
  scope.onmessage = async event => {
    const message = event.data || {};
    if (message.type === "cancel") { if (active?.id === message.id) active.controller.abort(); return; }
    if (active) active.controller.abort();
    const job = { id: message.id, controller: new AbortController() };
    active = job;
    const options = { signal: job.controller.signal, isCurrent: () => active === job, onProgress: progress => { if (active === job) scope.postMessage({ id: job.id, type: "progress", progress }); } };
    try {
      let result;
      if (message.type === "init") { engine = new PublicEngine(message.manifest, message.rootURL); result = { ready: true }; }
      else if (!engine) throw new Error("El catálogo público todavía no está listo.");
      else if (message.type === "query") result = await engine.query(message.params, options);
      else if (message.type === "csv") result = await engine.csv(message.params, options);
      else throw new Error("Operación no admitida.");
      engine.check(options);
      scope.postMessage({ id: job.id, type: "result", result });
    } catch (error) {
      scope.postMessage({ id: job.id, type: "error", error: { name: error.name || "Error", message: error.message || "No se pudo consultar el catálogo público." } });
    } finally { if (active === job) active = null; }
  };
})(typeof self !== "undefined" ? self : globalThis);
