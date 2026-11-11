/* ST Remesas - private, read-only verification API. Deployed only behind Vercel Authentication (All Deployments). */
'use strict';
const {createHash}=require('node:crypto');
const PUBLIC='https://st-remesas.vercel.app';
const SOURCE_NAMES={google_places:'Google Places',foursquare:'Foursquare Places',yelp:'Yelp Fusion',opencorporates:'OpenCorporates',twilio:'Twilio Lookup'};
const SECRETS={google_places:'GOOGLE_PLACES_API_KEY',foursquare:'FOURSQUARE_API_KEY',yelp:'YELP_API_KEY',opencorporates:'OPENCORPORATES_API_TOKEN',twilio:'TWILIO_ACCOUNT_SID'};
const clean=s=>String(s??'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,180);
const norm=s=>clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(street|str|st\.|avenue|ave\.|road|rd\.|boulevard|blvd\.|suite|ste\.|unit|apt\.)\b/g,x=>({street:'st',str:'st','st.':'st',avenue:'ave','ave.':'ave',road:'rd','rd.':'rd',boulevard:'blvd','blvd.':'blvd',suite:'ste','ste.':'ste',unit:'ste','apt.':'apt'}[x]||x)).replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function e164(p){let v=clean(p).replace(/[^+\d]/g,'');if(/^\d{10}$/.test(v))v='+1'+v;else if(/^1\d{10}$/.test(v))v='+'+v;return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(v)?v:null;}
function configs(){return Object.fromEntries(Object.entries(SECRETS).map(([key,env])=>[key,{name:SOURCE_NAMES[key],configured:key==='twilio'?Boolean(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN):Boolean(process.env[env]),purpose:key==='twilio'?'Tipo y operador técnico, NO titularidad':key==='opencorporates'?'Registro legal, NO sucursal activa':'Coincidencia de establecimiento, NO remesas confirmadas'}]));}
function score(base,hit){const q=norm(base.name),n=norm(hit.name),addr=norm(base.address),a=norm(hit.address);let s=0;if(q&&n){if(q===n)s+=55;else if(q.includes(n)||n.includes(q))s+=30;}if(addr&&a){if(addr===a)s+=35;else if(addr.split(' ').slice(0,2).every(x=>a.includes(x)))s+=15;}if(norm(base.city)&&norm(base.city)===norm(hit.city))s+=10;return Math.min(99,s);}
function formatHit(base,hit){return {...hit,confidence_score:score(base,hit),classification:'CANDIDATO_REVISAR',service_verified:false,phone_owner_verified:false};}
async function jsonFetch(url,{method='GET',headers={},body,timeout=8000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const r=await fetch(url,{method,headers,body,signal:controller.signal,redirect:'error'});if(!r.ok)throw new Error('ORIGEN_HTTP_'+r.status);const len=Number(r.headers.get('content-length')||0);if(len>1500000)throw new Error('RESPUESTA_EXCESIVA');const raw=await r.text();if(raw.length>1500000)throw new Error('RESPUESTA_EXCESIVA');return JSON.parse(raw)}finally{clearTimeout(timer)}
}
async function lookup(provider,base){
 const settings=configs();if(!settings[provider])throw new Error('PROVEEDOR_DESCONOCIDO');if(!settings[provider].configured)throw new Error('API_NO_CONFIGURADA');
 const query=[base.name,base.address,base.city,base.state].filter(Boolean).join(' ').slice(0,240);
 if(provider==='google_places'){
  const body={textQuery:query,maxResultCount:5,languageCode:'en'};
  const obj=await jsonFetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_PLACES_API_KEY,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.businessStatus'},body:JSON.stringify(body)});
  return (obj.places||[]).slice(0,5).map(p=>formatHit(base,{source:provider,source_id:p.id||'',name:p.displayName?.text||'',address:p.formattedAddress||'',city:'',url:p.googleMapsUri||'',business_status:p.businessStatus||'DESCONOCIDO',phone:'',note:'Google Places: búsqueda de ubicación; solicitar teléfono requiere otro SKU y licencia.'}));
 }
 if(provider==='foursquare'){
  const qs=new URLSearchParams({query:base.name,near:[base.city,base.state].filter(Boolean).join(', '),limit:'5'});
  const obj=await jsonFetch('https://places-api.foursquare.com/places/search?'+qs,{headers:{authorization:'Bearer '+process.env.FOURSQUARE_API_KEY,'X-Places-Api-Version':'2025-06-17',accept:'application/json'}});
  const rows=obj.results||obj.places||[];
  return rows.slice(0,5).map(p=>formatHit(base,{source:provider,source_id:p.fsq_place_id||p.fsq_id||'',name:p.name||'',address:p.location?.formatted_address||p.location?.address||'',city:p.location?.locality||'',url:p.link||p.website||'',phone:p.tel||'',note:'Foursquare: coincidencia documental; teléfono sin verificar.'}));
 }
 if(provider==='yelp'){
  const qs=new URLSearchParams({term:base.name,location:[base.city,base.state].filter(Boolean).join(', '),limit:'5'});
  const obj=await jsonFetch('https://api.yelp.com/v3/businesses/search?'+qs,{headers:{authorization:'Bearer '+process.env.YELP_API_KEY,accept:'application/json'}});
  return (obj.businesses||[]).slice(0,5).map(p=>formatHit(base,{source:provider,source_id:p.id||'',name:p.name||'',address:(p.location?.display_address||[]).join(', '),city:p.location?.city||'',url:p.url||'',phone:p.display_phone||p.phone||'',note:'Yelp: datos publicados, sin comprobación por llamada.'}));
 }
 if(provider==='opencorporates'){
  const qs=new URLSearchParams({q:base.name,order:'score',per_page:'5'});
  const obj=await jsonFetch('https://api.opencorporates.com/v0.4/companies/search?'+qs,{headers:{'X-API-TOKEN':process.env.OPENCORPORATES_API_TOKEN,accept:'application/json'}});
  return (obj.results?.companies||[]).slice(0,5).map(x=>{const p=x.company||x;return formatHit(base,{source:provider,source_id:[p.jurisdiction_code,p.company_number].join('/'),name:p.name||'',address:p.registered_address_in_full||'',city:'',url:p.opencorporates_url||'',phone:'',company_status:p.current_status||'',note:'Registro de entidad legal, no certifica punto de remesas.'})});
 }
 if(provider==='twilio'){
  const p=e164(base.phone);if(!p)throw new Error('TELEFONO_NO_VALIDO_US_CA_PR');
  const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
  const auth=Buffer.from(sid+':'+token).toString('base64');
  const obj=await jsonFetch('https://lookups.twilio.com/v2/PhoneNumbers/'+encodeURIComponent(p)+'?Fields=line_type_intelligence',{headers:{authorization:'Basic '+auth,accept:'application/json'}});
  return [{source:'twilio',phone:obj.phone_number||p,valid:obj.valid===true,line_type:obj.line_type_intelligence?.type||'',carrier_name:obj.line_type_intelligence?.carrier_name||'',phone_owner_verified:false,service_verified:false,note:'Tipo técnico de línea; NO confirma titular ni conexión con el negocio.'}];
 }
 return [];
}
let cache=null;
async function liveBaseline(){
 if(cache&&Date.now()-cache.at<240000)return cache.value;
 // Each segment is fetched from a fixed, audited hostname; no user-provided URL allowed.
 let parts=new Array(27);for(let offset=0;offset<27;offset+=5){const tasks=Array.from({length:Math.min(5,27-offset)},(_,j)=>offset+j).map(async i=>{
  const u=PUBLIC+'/data/'+String(i).padStart(3,'0')+'.txt';const controller=new AbortController(),t=setTimeout(()=>controller.abort(),6000);
  try{const r=await fetch(u,{signal:controller.signal,redirect:'error'});if(!r.ok)throw new Error('SEGMENTO_'+i+'_'+r.status);const str=await r.text();if(str.length>400000)throw new Error('SEGMENTO_GRANDE');parts[i]=str;}finally{clearTimeout(t)}
 });await Promise.all(tasks)}
 const joined=parts.join('');if(joined.length>11000000)throw new Error('CATALOGO_DEMASIADO_GRANDE');const obj=JSON.parse(joined);if(!Array.isArray(obj.records)||obj.records.length<1)throw new Error('CATALOGO_INVALIDO');const ids=new Set(obj.records.map(x=>x.id));if(ids.size!==obj.records.length)throw new Error('IDS_DUPLICADOS');
 const value={records:obj.records,updated_at:obj.metadata?.updated_at||'',hash:createHash('sha256').update(joined).digest('hex'),checked_at:new Date().toISOString()};cache={at:Date.now(),value};return value;
}
async function compare(base){const cat=await liveBaseline();const exact=[],address=[],phone=[];const k=norm(base.name),a=norm(base.address),c=norm(base.city),s=norm(base.state),p=e164(base.phone);
 if(!k||!a||!c||!s)throw new Error('FALTAN_IDENTIFICADORES');
 for(const row of cat.records){if(norm(row.city)!==c||norm(row.state)!==s)continue;
  const nr=norm(row.name),ar=norm(row.address);let kind='';if(nr===k&&ar===a)kind='MISMA_IDENTIDAD';else if(ar===a)kind='DOMICILIO_COMPARTIDO';else if(p&&e164(row.phone)===p)kind='TELEFONO_COMPARTIDO';if(!kind)continue;
  const match={id:clean(row.id),name:clean(row.name),address:clean(row.address),city:clean(row.city),state:clean(row.state),kind,source:'ST_REMESAS_PUBLICO',note:'Comparación documental; no certifica teléfonos ni servicios.'};
  if(kind==='MISMA_IDENTIDAD')exact.push(match);else if(kind==='DOMICILIO_COMPARTIDO')address.push(match);else phone.push(match);
 }
 return {baseline:{site:PUBLIC,records:cat.records.length,updated_at:cat.updated_at,snapshot_sha256:cat.hash,checked_at:cat.checked_at},classification:exact.length?'PRESENTE_EN_CATALOGO':address.length||phone.length?'POSIBLE_DUPLICADO_REVISAR':'SIN_COINCIDENCIA_DETECTADA',counts:{exact:exact.length,address:address.length,phone:phone.length},matches:[...exact,...address,...phone].slice(0,12),automatic_merge:false};}
function validate(body){if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('DATOS_INVALIDOS');const b={name:clean(body.name),address:clean(body.address),city:clean(body.city),state:clean(body.state),phone:clean(body.phone)};if(b.name.length<2||b.name.length>120)throw new Error('NOMBRE_REQUERIDO');if(b.city.length<2||!/[a-z]/i.test(b.city))throw new Error('CIUDAD_REQUERIDA');if(!/^[A-Za-z]{2}$/.test(b.state))throw new Error('ESTADO_2_LETRAS');if(b.address.length>140)throw new Error('DOMICILIO_INVALIDO');return b;}
function reply(res,code,obj){res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(obj));}
async function handler(req,res){
 try{
  if(req.method==='GET')return reply(res,200,{project:'st-remesas-admin',public_site:PUBLIC,privacy:'Solo Vercel Authentication · All Deployments',publication:false,providers:configs(),features:{compare:true,manual_import:true,automatic_merge:false,automatic_call:false},message:'Sin credenciales los conectores permanecen desactivados.'});
  if(req.method!=='POST')return reply(res,405,{error:'METODO_NO_PERMITIDO'});
  const origin=req.headers.origin;const host=req.headers.host;
  if(!origin||!host||origin!==`https://${host}`)return reply(res,403,{error:'ORIGEN_NO_AUTORIZADO'});
  if(Number(req.headers['content-length']||0)>8000)return reply(res,413,{error:'CUERPO_EXCESIVO'});
  const data=typeof req.body==='string'?JSON.parse(req.body):req.body;
  const action=clean(data?.action);const input=validate(data?.business);
  if(action==='compare')return reply(res,200,{ok:true,action,result:await compare(input)});
  if(action==='lookup'){
   const provider=clean(data?.provider);if(!Object.hasOwn(SOURCE_NAMES,provider))return reply(res,400,{error:'PROVEEDOR_DESCONOCIDO'});
   const results=await lookup(provider,input);return reply(res,200,{ok:true,action,provider,results,observed_at:new Date().toISOString(),saved:false});
  }
  return reply(res,400,{error:'ACCION_NO_PERMITIDA'});
 }catch(e){const safe=['API_NO_CONFIGURADA','TELEFONO_NO_VALIDO_US_CA_PR','NOMBRE_REQUERIDO','CIUDAD_REQUERIDA','ESTADO_2_LETRAS','DOMICILIO_INVALIDO','FALTAN_IDENTIFICADORES','DATOS_INVALIDOS','ORIGEN_NO_AUTORIZADO','CUERPO_EXCESIVO','CATALOGO_INVALIDO','IDS_DUPLICADOS'].includes(e.message);
  // No API keys, full upstream responses, phone numbers or business names are logged or returned in errors.
  return reply(res,safe?400:503,{error:safe?e.message:'FUENTE_NO_DISPONIBLE',message:safe?'Corrige los datos o configura la credencial en Vercel.':'No fue posible completar la consulta; reintenta más tarde.'});
 }
}
module.exports=handler;module.exports._test={clean,norm,e164,score,validate,compare,lookup,configs};