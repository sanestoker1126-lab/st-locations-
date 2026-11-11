/* ST Remesas – herramientas de verificación externa v3. Pure enhancement, no source mutation. */
(function (global) {
  'use strict';
  const SITE = 'ST Remesas';
  const PROVIDERS = Object.freeze({
    maps: 'Google Maps', osm: 'OpenStreetMap', bing: 'Bing',
    manta: 'Manta', bizapedia: 'Bizapedia', opencorporates: 'OpenCorporates',
    yelp: 'Yelp', businessdb: 'Small Business Database'
  });
  function safe(s) { return String(s == null ? '' : s).trim().slice(0, 320); }
  function cleanPhone(input) {
    const original = safe(input).replace(/[^\d+]/g, '');
    // Don't treat short codes or arbitrary number-like labels as dialable.
    const digits = original.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return '';
    return original.startsWith('+') ? `+${digits}` : digits;
  }
  function query(info) { return [safe(info.name), safe(info.address)].filter(Boolean).join(' '); }
  function buildSearchUrls(info) {
    const name = safe(info.name), address = safe(info.address), q = query(info);
    if (!name && !address) return {};
    const encoded = encodeURIComponent(q), encodedName = encodeURIComponent(name || q);
    return {
      maps: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
      osm: `https://www.openstreetmap.org/search?query=${encoded}`,
      bing: `https://www.bing.com/search?q=${encoded}`,
      manta: `https://www.manta.com/search?search=${encoded}`,
      bizapedia: `https://www.google.com/search?q=${encodeURIComponent('site:bizapedia.com ' + q)}`,
      opencorporates: `https://opencorporates.com/companies?q=${encodedName}`,
      yelp: `https://www.yelp.com/search?find_desc=${encodedName}&find_loc=${encodeURIComponent(address)}`,
      businessdb: `https://www.google.com/search?q=${encodeURIComponent('site:smallbusinessdb.com ' + q)}`
    };
  }
  function browserIntent(url, packageName) {
    const supported = new Set(['com.android.chrome', 'com.opera.browser']);
    if (!supported.has(packageName)) throw new TypeError('Browser no permitido');
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) throw new TypeError('HTTPS requerido');
    // Intent only on deliberate click, never automatically: Android decides if app can handle it.
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${packageName};S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
  }
  function create(tag, className, label) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (label != null) el.textContent = label;
    return el;
  }
  function link(text, url, css) {
    const a = create('a', css || 'stx-link', text);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new TypeError('URL insegura');
    a.href = parsed.href;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function makeButton(text, action, extra) {
    const b = create('button', 'stx-button', text);
    b.type = 'button'; b.dataset.stxAction = action;
    if (extra) b.dataset.stxParam = extra;
    return b;
  }
  function infoFromCard(card) {
    const phoneHref = card.querySelector('.profiles a[href^="tel:"]');
    return {
      id: safe(card.getAttribute('data-record-id')),
      name: safe(card.querySelector('h3')?.textContent),
      address: safe(card.querySelector('.address')?.textContent).replace(/\s+/g, ' '),
      phone: cleanPhone(phoneHref?.getAttribute('href')?.slice(4))
    };
  }
  const registry = new WeakMap();
  function addToCard(card) {
    if (registry.has(card) || card.querySelector('.stx-tools')) return;
    const info = infoFromCard(card);
    if (!info.name) return;
    registry.set(card, info);
    const parent = card.querySelector('.card-main') || card;
    const details = create('details', 'stx-tools');
    const summary = create('summary', '', 'Más opciones · consultar, llamar y comparar');
    const content = create('div', 'stx-inner');
    const note = create('p', 'stx-note', 'Las consultas abren sitios externos. Ni los teléfonos ni el servicio de remesas se verifican automáticamente.');
    const selected = create('select', 'stx-select');
    selected.setAttribute('aria-label', `Fuente externa para ${info.name}`);
    for (const [k, n] of Object.entries(PROVIDERS)) {
      const opt = create('option', '', n);opt.value=k;selected.appendChild(opt);
    }
    const tools = create('div', 'stx-grid');
    const open = makeButton('Buscar coincidencia', 'open');
    const chrome = makeButton('Abrir en Chrome', 'browser', 'com.android.chrome');
    const opera = makeButton('Abrir en Opera', 'browser', 'com.opera.browser');
    const copy = makeButton('Copiar ficha', 'copy');
    const phone = info.phone ? makeButton('Copiar teléfono', 'phone') : create('span','stx-muted','Teléfono no disponible');
    const call = info.phone ? create('a', 'stx-link', 'Llamar con app del dispositivo') : null;
    if (call) call.href=`tel:${info.phone}`;
    const talk = link('Talkatone · abrir app/descarga', 'https://play.google.com/store/apps/details?id=com.talkatone.android');
    const crm = link('Bizzi CRM · sitio externo', 'https://getbizzi.app/');
    const busa = create('span','stx-muted','Busafill: pendiente de URL oficial');
    const status = create('span','stx-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    for (const child of [open,chrome,opera,copy,phone,call,talk,crm,busa].filter(Boolean)) tools.appendChild(child);
    content.append(note,selected,tools,status);
    details.append(summary,content);
    parent.append(details);
    details.addEventListener('click', async (event)=>{
      const button=event.target.closest('button[data-stx-action]');
      if (!button || !details.contains(button)) return;
      const action=button.dataset.stxAction;
      const target=buildSearchUrls(info)[selected.value];
      if (action==='open' && target) {global.open(target,'_blank','noopener,noreferrer');return;}
      if (action==='browser' && target) {
        const isAndroid=/Android/i.test(global.navigator?.userAgent||'');
        if (!isAndroid) {global.open(target,'_blank','noopener,noreferrer');return;}
        try {global.location.href=browserIntent(target,button.dataset.stxParam);} catch{global.open(target,'_blank','noopener,noreferrer');}
        return;
      }
      if (action==='copy' || action==='phone') {
        const value = action==='phone' ? info.phone : [info.name, info.address, info.phone, info.id].filter(Boolean).join(' | ');
        try {await global.navigator.clipboard.writeText(value);status.textContent='Copiado. Verifica la fuente antes de actualizar una ficha.';}
        catch {status.textContent='Copia no disponible; utiliza el enlace externo.';}
      }
    });
  }
  function setup() {
    if (!document.getElementById('stx-style')) {
      const style=create('style');style.id='stx-style';style.textContent=`
.stx-tools{margin:14px 0 0;border:1px solid #c5d5d1;border-radius:13px;background:#f1f7f6;max-width:100%;color:#183e36}
.stx-tools>summary{font-weight:700;font-size:.88rem;cursor:pointer;padding:12px 13px;list-style-position:inside}
.stx-tools[open]>summary{border-bottom:1px solid #c5d5d1}.stx-inner{padding:12px}.stx-note{font-size:.78rem;line-height:1.45;color:#4b605f;margin:0 0 10px}
.stx-select{padding:10px;width:100%;max-width:100%;min-width:0;border-radius:9px;border:1px solid #9eb6b2;background:white;color:#153e35}
.stx-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
.stx-link,.stx-button{display:flex;align-items:center;justify-content:center;min-height:38px;padding:7px 10px;font-size:.76rem;text-align:center;border-radius:9px;border:1px solid #8fb4ad;background:#fff;color:#123e35;text-decoration:none;cursor:pointer;overflow-wrap:anywhere;font-weight:600}
.stx-link:hover,.stx-button:hover{background:#e2f2ef}.stx-button:focus-visible,.stx-link:focus-visible{outline:3px solid #b8860b;outline-offset:2px}
.stx-muted{font-size:.74rem;line-height:1.4;color:#596968;align-self:center}.stx-status{font-size:.78rem;display:block;margin-top:8px;color:#17473e}
@media(max-width:480px){.stx-grid{grid-template-columns:1fr}.stx-tools>summary{font-size:.84rem}}
`;document.head.appendChild(style);
    }
    const root=document.getElementById('results');if(!root)return;
    root.querySelectorAll('.business-card').forEach(addToCard);
    const observer=new MutationObserver((mutations)=>{
      if(!mutations.some(m=>m.addedNodes.length>0))return;
      root.querySelectorAll('.business-card').forEach(addToCard);
    });
    observer.observe(root,{childList:true,subtree:false});
  }
  const api=Object.freeze({buildSearchUrls,browserIntent,cleanPhone,infoFromCard,PROVIDERS});
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else {
    global.STRemesasConnectors=api;
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
  }
})(typeof window==='undefined' ? globalThis : window);