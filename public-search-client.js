/* Browser transport for the complete GitHub Pages catalogue. No API server is required. */
(function () {
  "use strict";
  const scriptURL = document.currentScript?.src || new URL("public-search-client.js", document.baseURI).href;
  const siteRoot = new URL("./", scriptURL);
  const abortError = () => new DOMException("Consulta cancelada.", "AbortError");

  class PublicSource {
    constructor(manifest) {
      this.metadata = manifest.metadata;
      this.kind = "public";
      this.onprogress = null;
      this.worker = new Worker(new URL("public-search-worker.js", siteRoot));
      this.pending = new Map();
      this.sequence = 0;
      this.closed = false;
      this.worker.onmessage = event => {
        const message = event.data || {}, request = this.pending.get(message.id);
        if (!request) return;
        if (message.type === "progress") { this.onprogress?.(message.progress); return; }
        this.pending.delete(message.id); request.cleanup();
        if (message.type === "error") request.reject(Object.assign(new Error(message.error?.message || "No se pudo consultar el catálogo público."), { name: message.error?.name || "Error" }));
        else if (message.type === "result") request.resolve(message.result);
        else request.reject(new Error("Respuesta desconocida del catálogo público."));
      };
      this.worker.onerror = event => {
        event.preventDefault();
        this.failAll(new Error("No se pudo ejecutar la búsqueda pública. Recarga y vuelve a intentarlo."));
        this.worker.terminate(); this.closed = true;
      };
      this.worker.onmessageerror = () => this.failAll(new Error("El navegador no pudo leer la respuesta del catálogo."));
      this.manifest = manifest;
    }
    failAll(error) {
      for (const request of this.pending.values()) { request.cleanup(); request.reject(error); }
      this.pending.clear();
    }
    request(type, payload, options = {}) {
      if (this.closed) return Promise.reject(new Error("La búsqueda pública se cerró. Recarga la página."));
      if (options.signal?.aborted) return Promise.reject(abortError());
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        const abort = () => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id); cleanup();
          this.worker.postMessage({ type: "cancel", id }); reject(abortError());
        };
        const cleanup = () => options.signal?.removeEventListener("abort", abort);
        this.pending.set(id, { resolve, reject, cleanup });
        options.signal?.addEventListener("abort", abort, { once: true });
        try { this.worker.postMessage({ id, type, ...payload }); }
        catch (error) { this.pending.delete(id); cleanup(); reject(error); }
      });
    }
    query(params, options = {}) {
      return this.request("query", { params: [...new URLSearchParams(params).entries()] }, options);
    }
    async exportCsv(params, options = {}) {
      if (options.signal?.aborted) throw abortError();
      const values = new URLSearchParams(params);
      const hasFilter = ["q", "country", "region", "category", "group", "platform"].some(key => Boolean(values.get(key)?.trim())) || ![null, "", "all"].includes(values.get("proof"));
      if (!hasFilter) return { url: new URL("downloads/base-maestra-global-csv.zip", siteRoot).href, name: "base-maestra-global-csv.zip" };
      return this.request("csv", { params: [...values.entries()] }, options);
    }
    close() {
      this.closed = true; this.worker.terminate(); this.failAll(abortError());
    }
  }

  async function open(manifestURL = new URL("data/public/manifest.json", siteRoot), options = {}) {
    const response = await fetch(new URL(manifestURL, document.baseURI), { cache: "no-cache", signal: options.signal });
    if (!response.ok) throw Object.assign(new Error("No se pudo cargar el índice público (HTTP " + response.status + ")."), { status: response.status });
    const manifest = await response.json();
    if (!manifest || manifest.version !== 1 || !manifest.metadata || !Number.isFinite(Number(manifest.total))) throw new Error("El índice público tiene un formato no admitido.");
    if (options.signal?.aborted) throw abortError();
    const source = new PublicSource(manifest);
    try {
      await source.request("init", { manifest, rootURL: siteRoot.href }, options);
      return source;
    } catch (error) { source.close(); throw error; }
  }
  window.STPublicContacts = { open };
})();
