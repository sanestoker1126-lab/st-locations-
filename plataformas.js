/* Registro de fuentes públicas: los enlaces y las búsquedas no son contactos. */
(() => {
  'use strict';

  const PAGE_SIZE = 12;
  const SAMPLE_LIMIT = 20;
  const TYPE_LABELS = { platform: 'Plataforma de negocios', social: 'Red social', document: 'Documento público', search: 'Motor de búsqueda' };
  const STATUS_LABELS = { retrieved: 'Obtenida', partial: 'Extracción parcial', linked_only: 'Solo enlace', login_required: 'Requiere sesión', error: 'Error al consultar', discovered: 'Descubierta, sin extracción' };
  const NO_EXTRACTION = new Set(['linked_only', 'login_required', 'error', 'discovered']);
  const numberFormat = new Intl.NumberFormat('es-MX');
  const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' });
  const elements = {};
  let sources = [];
  let filtered = [];
  let currentPage = 1;
  let requestNumber = 0;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }

  function count(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  function actualCount(source) {
    return source.source_type === 'search' || NO_EXTRACTION.has(source.status) ? 0 : count(source.obtained_records);
  }

  function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value));
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function displayDate(value) {
    if (!value) return 'Sin fecha publicada';
    if (/^\d{4}(?:-\d{2}){0,2}$/.test(String(value))) return String(value);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
  }

  function samples(source) {
    return Array.isArray(source.sample_records) ? source.sample_records.filter(record => record && typeof record === 'object') : [];
  }

  function countries(source) {
    const values = [source.country, ...(Array.isArray(source.countries) ? source.countries : []), ...samples(source).map(record => record.country)];
    return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  }

  function notes(source) {
    return Array.isArray(source.notes) ? source.notes.map(String).join('\n') : String(source.notes ?? '');
  }

  function queries(source) {
    if (Array.isArray(source.queries)) return source.queries.map(String).filter(Boolean);
    return source.query ? [String(source.query)] : [];
  }

  function searchableText(source) {
    const records = samples(source).map(record => Object.values(record).filter(value => typeof value === 'string' || typeof value === 'number').join(' ')).join(' ');
    return normalize([source.title, source.platform, source.url, source.format, source.id, notes(source), queries(source).join(' '), countries(source).join(' '), records].join(' '));
  }

  function fillOptions(select, values) {
    while (select.options.length > 1) select.remove(1);
    values.sort((left, right) => left.localeCompare(right, 'es')).forEach(value => {
      const option = node('option', value);
      option.value = value;
      select.append(option);
    });
  }

  function addFact(list, label, value) {
    const wrapper = node('div');
    wrapper.append(node('dt', label), node('dd', value));
    list.append(wrapper);
  }

  function renderSamples(source, container) {
    const records = samples(source);
    if (!records.length || actualCount(source) === 0) return;
    const details = node('details', null, 'sample-details');
    const visible = records.slice(0, SAMPLE_LIMIT);
    details.append(node('summary', `Ver muestra de ${numberFormat.format(visible.length)} ${visible.length === 1 ? 'registro' : 'registros'}`));
    details.append(node('p', `Muestra de campos extraídos de esta fuente. Los teléfonos publicados no tienen una prueba de vigencia mediante llamada.${records.length > SAMPLE_LIMIT ? ` Se muestran los primeros ${SAMPLE_LIMIT} registros de la muestra.` : ''}`, 'sample-caption'));
    const wrapper = node('div', null, 'sample-table-wrap');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', `Muestra de contactos: ${source.title || source.platform || source.id}`);
    const table = node('table', null, 'sample-table');
    const head = node('thead');
    const headings = node('tr');
    ['Negocio', 'Ubicación', 'Teléfono publicado', 'ID en la fuente'].forEach(label => {
      const th = node('th', label);
      th.scope = 'col';
      headings.append(th);
    });
    head.append(headings);
    const body = node('tbody');
    visible.forEach(record => {
      const row = node('tr');
      const location = [record.city, record.state, record.country].filter(Boolean).join(', ');
      row.append(node('td', record.name || 'Nombre no publicado'), node('td', location || 'Sin ubicación publicada'), node('td', record.phone || 'Sin teléfono publicado'), node('td', record.source_record_id || record.id || 'Sin ID publicado'));
      body.append(row);
    });
    table.append(head, body);
    wrapper.append(table);
    details.append(wrapper);
    container.append(details);
  }

  function renderSource(source) {
    const card = node('article', null, 'source-card');
    const header = node('div', null, 'source-card-header');
    const badges = node('div', null, 'source-badges');
    const status = Object.hasOwn(STATUS_LABELS, source.status) ? source.status : 'discovered';
    badges.append(node('span', source.platform || 'Plataforma sin identificar', 'source-badge'), node('span', TYPE_LABELS[source.source_type] || 'Fuente pública', 'source-badge'), node('span', STATUS_LABELS[status], `source-badge source-status-${status}`));
    header.append(badges, node('h3', source.title || source.id || 'Fuente sin título'));
    const url = safeUrl(source.url);
    if (url) {
      const link = node('a', url, 'source-link');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `Abrir fuente original en otra pestaña: ${source.title || source.platform || url}`);
      header.append(link);
    } else {
      header.append(node('span', 'Sin enlace público válido', 'source-url-unavailable'));
    }
    const detail = node('div', null, 'source-details');
    const facts = node('dl', null, 'source-facts');
    const obtained = actualCount(source);
    addFact(facts, 'Fecha de consulta', displayDate(source.retrieved_at));
    addFact(facts, 'Formato', source.format || 'No indicado');
    addFact(facts, 'Registros obtenidos', numberFormat.format(obtained));
    addFact(facts, 'Nuevas / ya en la base', `${numberFormat.format(obtained ? count(source.new_locations) : 0)} / ${numberFormat.format(obtained ? count(source.existing_matches) : 0)}`);
    detail.append(facts);
    if (source.source_type === 'search') detail.append(node('p', 'Consulta de descubrimiento: los resultados del motor no se cuentan como registros extraídos.', 'source-extraction-note'));
    else if (NO_EXTRACTION.has(status)) detail.append(node('p', 'Sin extracción de contactos en esta consulta. Esta referencia no incrementa el total de registros obtenidos.', 'source-extraction-note'));
    else if (!obtained) detail.append(node('p', 'La consulta no produjo filas de contactos extraídas.', 'source-extraction-note'));
    const sourceQueries = queries(source);
    sourceQueries.forEach(query => detail.append(node('p', `Consulta: ${query}`, 'source-query-text')));
    const countryList = countries(source);
    if (countryList.length) detail.append(node('p', `Países observados: ${countryList.join(', ')}`, 'source-country-list'));
    if (notes(source)) detail.append(node('p', notes(source), 'source-notes'));
    if (obtained > 0 && !NO_EXTRACTION.has(status) && source.source_type !== 'search') {
      const historical = source.historical === true || /^\s*hist[oó]rico\b/i.test(notes(source));
      const socialIdentityOnly = source.source_type === 'social' && source.phone_contacts_extracted === 0;
      const action = node('a', historical ? 'Ver registros históricos (JSON)' : socialIdentityOnly ? 'Ver negocio relacionado' : 'Ver registros en la base', 'outline-button');
      if (historical) {
        action.href = '/st-locations-/data/historical-document-contacts.json';
      } else {
        const params = new URLSearchParams();
        const sample = samples(source)[0];
        if (socialIdentityOnly && sample?.name) params.set('q', sample.name);
        else if (!socialIdentityOnly && source.platform) params.set('platform', source.platform);
        const country = source.country || sample?.country;
        if (country) params.set('country', country);
        if (source.region) params.set('region', source.region);
        action.href = '/base.html?' + params;
      }
      const actionRow = node('p');
      actionRow.append(action);
      detail.append(actionRow);
    }
    renderSamples(source, detail);
    if (source.sha256) detail.append(node('code', `SHA-256 del archivo obtenido: ${String(source.sha256)}`, 'source-hash'));
    card.append(header, detail);
    return card;
  }

  function renderResults() {
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount);
    elements.list.replaceChildren();
    filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).forEach(source => elements.list.append(renderSource(source)));
    const obtained = filtered.reduce((total, source) => total + actualCount(source), 0);
    elements.resultCount.textContent = `${numberFormat.format(filtered.length)} de ${numberFormat.format(sources.length)} fuentes · ${numberFormat.format(obtained)} registros obtenidos en las fuentes mostradas.`;
    elements.empty.hidden = filtered.length > 0;
    elements.emptyDetail.textContent = sources.length ? 'No hay coincidencias con estos filtros. Prueba otra búsqueda o limpia los filtros.' : 'Aún no se han incorporado fuentes al registro.';
    elements.export.disabled = filtered.length === 0;
    elements.pagination.hidden = filtered.length <= PAGE_SIZE;
    elements.previous.disabled = currentPage <= 1;
    elements.next.disabled = currentPage >= pageCount;
    elements.pageLabel.textContent = `Página ${currentPage} de ${pageCount}`;
  }

  function applyFilters() {
    const terms = normalize(elements.query.value).split(/\s+/).filter(Boolean);
    filtered = sources.filter(source => (!elements.platform.value || source.platform === elements.platform.value) && (!elements.type.value || source.source_type === elements.type.value) && (!elements.status.value || source.status === elements.status.value) && (!elements.country.value || countries(source).includes(elements.country.value)) && terms.every(term => source._searchText.includes(term)));
    currentPage = 1;
    renderResults();
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    if (!filtered.length) return;
    const rows = [['ID de fuente', 'Título', 'Plataforma o motor', 'Tipo de fuente', 'Formato', 'URL original', 'Fecha de consulta', 'Resultado', 'Registros obtenidos', 'Ubicaciones nuevas', 'Coincidencias existentes', 'Países observados', 'Consultas', 'Notas', 'SHA-256']];
    filtered.forEach(source => {
      const obtained = actualCount(source);
      rows.push([source.id, source.title, source.platform, TYPE_LABELS[source.source_type] || source.source_type, source.format, safeUrl(source.url) || '', source.retrieved_at, STATUS_LABELS[source.status] || source.status, obtained, obtained ? count(source.new_locations) : 0, obtained ? count(source.existing_matches) : 0, countries(source).join('; '), queries(source).join('; '), notes(source), source.sha256]);
    });
    const blob = new Blob(['\uFEFF', rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url;
    link.download = `fuentes-publicas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadSources() {
    const request = ++requestNumber;
    elements.error.hidden = true;
    elements.empty.hidden = true;
    elements.export.disabled = true;
    elements.list.setAttribute('aria-busy', 'true');
    elements.meta.textContent = 'Cargando el registro de fuentes…';
    elements.retry.disabled = true;
    try {
      const response = await fetch('/st-locations-/data/platform-sources.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.sources)) throw new Error('El archivo no contiene una lista de fuentes válida.');
      if (request !== requestNumber) return;
      sources = data.sources.filter(source => source && typeof source === 'object').map(source => ({ ...source, _searchText: searchableText(source) }));
      fillOptions(elements.platform, [...new Set(sources.map(source => source.platform).filter(value => typeof value === 'string' && value.trim()))]);
      const countryValues = [...new Set(sources.flatMap(countries))];
      fillOptions(elements.country, countryValues);
      elements.countryField.hidden = countryValues.length === 0;
      document.getElementById('stat-sources').textContent = numberFormat.format(sources.length);
      document.getElementById('stat-records').textContent = numberFormat.format(sources.reduce((total, source) => total + actualCount(source), 0));
      document.getElementById('stat-new').textContent = numberFormat.format(sources.reduce((total, source) => total + (actualCount(source) ? count(source.new_locations) : 0), 0));
      const searchCount = count(data.summary?.search_queries) || sources.filter(source => source.source_type === 'search').reduce((total, source) => total + Math.max(1, queries(source).length), 0);
      document.getElementById('stat-searches').textContent = numberFormat.format(searchCount);
      elements.meta.textContent = `Actualización del registro: ${displayDate(data.updated_at)}.${count(data.summary?.candidate_records) ? ` Candidatos informados para revisión: ${numberFormat.format(count(data.summary.candidate_records))}.` : ''}`;
      applyFilters();
    } catch (error) {
      if (request !== requestNumber) return;
      sources = [];
      filtered = [];
      elements.list.replaceChildren();
      elements.pagination.hidden = true;
      elements.resultCount.textContent = '';
      elements.meta.textContent = 'El registro no está disponible en esta carga.';
      elements.errorDetail.textContent = `No se pudo leer data/platform-sources.json. ${error instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : 'Comprueba la disponibilidad del archivo e inténtalo de nuevo.'}`;
      elements.error.hidden = false;
      ['stat-sources', 'stat-records', 'stat-new', 'stat-searches'].forEach(id => { document.getElementById(id).textContent = '—'; });
    } finally {
      if (request === requestNumber) {
        elements.list.setAttribute('aria-busy', 'false');
        elements.retry.disabled = false;
      }
    }
  }

  function init() {
    const ids = { query: 'source-query', platform: 'source-platform', type: 'source-type', status: 'source-status', country: 'source-country', countryField: 'country-field', list: 'source-list', resultCount: 'source-result-count', empty: 'source-empty', emptyDetail: 'source-empty-detail', export: 'export-sources', pagination: 'source-pagination', previous: 'previous-page', next: 'next-page', pageLabel: 'source-page-label', meta: 'registry-meta', error: 'source-error', errorDetail: 'source-error-detail', retry: 'retry-sources' };
    Object.entries(ids).forEach(([key, id]) => { elements[key] = document.getElementById(id); });
    document.getElementById('source-filters').addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
    elements.query.addEventListener('input', applyFilters);
    [elements.platform, elements.type, elements.status, elements.country].forEach(select => select.addEventListener('change', applyFilters));
    document.getElementById('source-filters').addEventListener('reset', () => { setTimeout(applyFilters, 0); });
    elements.export.addEventListener('click', exportCsv);
    elements.retry.addEventListener('click', loadSources);
    elements.previous.addEventListener('click', () => { currentPage -= 1; renderResults(); document.getElementById('results-heading').scrollIntoView({ block: 'start' }); });
    elements.next.addEventListener('click', () => { currentPage += 1; renderResults(); document.getElementById('results-heading').scrollIntoView({ block: 'start' }); });
    loadSources();
  }

  init();
})();
