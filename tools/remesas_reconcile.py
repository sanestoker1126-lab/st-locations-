#!/usr/bin/env python3
"""ST Locations: idempotent, evidence-preserving, conservative remittance entity reconciliation.
No phone or remittance-service verification is fabricated. No automatic publication.
Python stdlib only; CSV + ZIP and existing GitHub JSON (when available).
"""
import argparse, csv, hashlib, io, json, re, sqlite3, unicodedata, zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
SOURCES = {
 'candidatos_20261110': 'registro_unico_candidatos_remesas_2026_11_10.csv',
 'maestro_local_20261106': 'REMESAS_USA_CONSOLIDADO_AUDITADO_2026-11-06.csv',
 'arkansas_20261107': 'ARKANSAS_126_BASE_DE_TRABAJO_2026-11-07.csv',
 'florida_revision_20261110': 'FL_candidatos_revision_sin_telefono_2026_11_10.csv',
 'us_20261022': 'US_hoja_2026_10_22_revision_cruce.csv',
 'drive_maestra_20260917': 'Drive_Base_Maestra.csv',
 'drive_agentes_20260917': 'Drive_Agentes_Confirmados.csv',
 'fincen_msb_20261110': 'source.tsv.csv',
 'florida_ft2_a_20261110': 'MT_Locations_A.csv',
 'florida_ft2_b_20261110': 'MT_Locations_B.zip',
 'canada_us_pr_20261110': 'Negocios_US_PR_Canada.csv',
 'us_maestro_20261022': 'Negocios_EEUU_Maestro.csv',
 'maps_preliminar_20261022': 'Negocios_EEUU_Apify_preliminar.csv',
}
COMMERCIAL_PAT = re.compile(r'\b(?:WALGREENS?|CVS|WALMART|WAL\s*MART|7\s*ELEVEN|CIRCLE\s*K|TARGET|KROGER|PUBLIX|ALBERTSONS|SAFEWAY|RITE\s*AID|DOLLAR\s*GENERAL|DOLLAR\s*TREE|COSTCO|SAMS\s*CLUB|SPEEDWAY|FAMILY\s*DOLLAR|CASH\s*AMERICA)\b',re.I)
STATES={'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA','COLORADO':'CO','CONNECTICUT':'CT','DELAWARE':'DE','FLORIDA':'FL','GEORGIA':'GA','HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN','IOWA':'IA','KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD','MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS','MISSOURI':'MO','MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH','NEW JERSEY':'NJ','NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND','OHIO':'OH','OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC','SOUTH DAKOTA':'SD','TENNESSEE':'TN','TEXAS':'TX','UTAH':'UT','VERMONT':'VT','VIRGINIA':'VA','WASHINGTON':'WA','WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY','PUERTO RICO':'PR','ONTARIO':'ON','QUEBEC':'QC','BRITISH COLUMBIA':'BC','ALBERTA':'AB'}
JUNK_PHONES={'0000000000','1111111111','1234567890','9999999999'}

def clean(v):
 return '' if v is None else str(v).strip()
def norm(v):
 s=unicodedata.normalize('NFKD',clean(v)).encode('ascii','ignore').decode().upper()
 return re.sub(r'\s+',' ',re.sub(r'[^A-Z0-9]+',' ',s)).strip()
def country(v,state=''):
 v=norm(v)
 if v in {'CANADA','CA','CAN'}:return 'CA'
 if v in {'PR','PUERTO RICO'} or norm(state)=='PR':return 'PR'
 if v in {'MEXICO','MX'}:return 'MX'
 if v in {'US','USA','ESTADOS UNIDOS','UNITED STATES','EEUU','ESTADOS UNIDOS DE AMERICA',''}:return 'US'
 return v[:40]
def phone(v):
 s=re.sub(r'\D','',clean(v))
 if len(s)==11 and s[0]=='1':s=s[1:]
 if len(s)==10 and s not in JUNK_PHONES and s[0] not in '01' and s[3] not in '01':return '+1'+s
 return ''
def pick(row,*names):
 for n in names:
  v=clean(row.get(n,''))
  if v and v.lower() not in ('nan','none','null','n/a','26'):
   return v
 return ''

def adapt(source,row):
 if source=='canada_us_pr_20261110':
  d={'name':pick(row,'Nombre del Negocio'),'address':pick(row,'Direccion'),'city':pick(row,'Ciudad'),'state':pick(row,'Estado_Provincia'),'zip':'','country':pick(row,'Pais'),'phone':pick(row,'Telefono'),'service':pick(row,'Servicio Envio Dinero'),'source_type':'legacy_international_candidate','source_status':'SIN_VALIDACION_ACTUAL','owner':pick(row,'Propietario_Contacto'),'independence':'','source_url':''}
 elif source=='us_maestro_20261022':
  d={'name':pick(row,'Nombre del negocio'),'address':pick(row,'Dirección'),'city':pick(row,'Ciudad'),'state':pick(row,'Estado'),'zip':pick(row,'Código postal'),'country':'US','phone':pick(row,'Teléfono'),'service':pick(row,'Empresa(s) de remesas'),'source_type':'legacy_us_candidate','source_status':pick(row,'Estado de verificación'),'source_url':pick(row,'URL(s) de fuente'),'legacy_id':pick(row,'ID'),'owner':pick(row,'Propietario / contacto (si consta)')}
 elif source=='maps_preliminar_20261022':
  d={'name':pick(row,'Nombre en Maps'),'address':pick(row,'Dirección publicada'),'city':pick(row,'Ciudad'),'state':pick(row,'Estado'),'zip':pick(row,'CP'),'country':'US','phone':pick(row,'Teléfono publicado'),'service':pick(row,'Red/servicio inferido del nombre'),'source_type':'maps_unconfirmed','source_status':pick(row,'Estado de verificación'),'source_url':pick(row,'Ficha de Google Maps'),'place_id':pick(row,'Google Place ID')}
 elif source=='fincen_msb_20261110':
  acts=pick(row,'MSB ACTIVITIES')
  if '409' not in re.findall(r'\d+',acts):return None,'activity_not_money_transmission'
  d={'name':pick(row,'DBA NAME','LEGAL NAME'),'address':pick(row,'STREET ADDRESS'),'city':pick(row,'CITY'),'state':pick(row,'STATE'),'zip':pick(row,'ZIP'),'country':'US','service':'Money transmission code 409 (registered company; NOT proof of storefront remittances)','source_type':'regulatory_entity','source_status':'MSB 409','source_url':'','phone':''}
 elif source.startswith('florida_ft2_'):
  lic=pick(row,'LICENSE TYPE')
  if lic!='FT2':return None,'not_ft2'
  d={'name':pick(row,'LICENSEE NAME'),'address':pick(row,'PRIM ADDRESS 1'),'city':pick(row,'PRIM CITY'),'state':pick(row,'PRIM STATE'),'zip':pick(row,'PRIM ZIP'),'country':'US','service':'Florida FT2 license (not live service verification)','source_type':'regulatory_location','source_status':pick(row,'STATUS'),'source_url':'','phone':'','license':pick(row,'LICENSE NUMBER')}
 elif source=='candidatos_20261110':
  d={'name':pick(row,'nombre'),'address':pick(row,'direccion'),'city':pick(row,'ciudad'),'state':pick(row,'estado'),'zip':'','country':pick(row,'pais'),'phone':pick(row,'telefono_origen_sin_revalidar'),'service':pick(row,'grupos_evidencia'),'source_type':'aggregated_candidate','source_status':'CANDIDATO_NO_VERIFICADO','source_url':'','chain_claim':pick(row,'patron_cadena'),'previous_sources':pick(row,'fuentes')}
 elif source=='florida_revision_20261110':
  d={'name':pick(row,'nombre_reportado'),'address':pick(row,'direccion'),'city':pick(row,'ciudad'),'state':pick(row,'estado'),'zip':pick(row,'zip'),'country':'US','phone':pick(row,'telefono'),'service':pick(row,'tipo_licencia'),'source_type':'regulatory_candidate','source_status':pick(row,'decision'),'license':pick(row,'licencia_ref')}
 elif source=='us_20261022':
  d={'name':pick(row,'nombre'),'address':pick(row,'direccion'),'city':pick(row,'ciudad'),'state':pick(row,'estado'),'zip':'','country':'US','phone':pick(row,'telefono_original'),'service':'','source_type':'historic_candidate','source_status':pick(row,'estado_verificacion_origen'),'legacy_id':pick(row,'id_fuente')}
 elif source.startswith('drive_'):
  d={'name':pick(row,'business_name'),'address':pick(row,'address'),'city':pick(row,'city'),'state':pick(row,'state'),'zip':pick(row,'zip'),'country':'US','phone':pick(row,'phone'),'service':pick(row,'money_transfer_provider','provider'),'source_type':'drive_stated_agent','source_status':'SOURCE_CLAIMS_EVIDENCE_NOT_RECHECKED','source_url':pick(row,'source_url'),'secondary_url':pick(row,'secondary_source_url'),'independence':pick(row,'independent_status'),'source_claimed_verified_date':pick(row,'verified_date'),'owner':pick(row,'owner_or_contact')}
 else:
  d={'name':pick(row,'name','nombre','business_name'),'address':pick(row,'address','direccion'),'city':pick(row,'city','ciudad'),'state':pick(row,'state','estado'),'zip':pick(row,'zip','zipcode','postal_code'),'country':pick(row,'country','pais') or 'US','phone':pick(row,'phone','telefono'),'service':pick(row,'providers','money_transfer_provider'),'source_type':'local_historical','source_status':pick(row,'status'),'source_url':pick(row,'service_url','source_url'),'phone_url':pick(row,'phone_url'),'owner':pick(row,'owner_name'),'legacy_id':pick(row,'id'),'independence':pick(row,'independence')}
 if not d.get('name') or not d.get('address') or not d.get('city') or not d.get('state'):return None,'missing_identity_fields'
 d['country']=country(d.get('country',''),d.get('state',''))
 d['state']=STATES.get(norm(d['state']),d['state'])
 d['phone_raw']=d.get('phone','')
 d['phone']=phone(d.get('phone',''))
 d['chain_suspect']=bool(COMMERCIAL_PAT.search(d['name'])) or norm(d.get('chain_claim',''))=='SI' or 'EXCLUIDO_CADENA' in norm(d.get('source_status','')) or 'EXCLUIDO CADENA' in norm(d.get('independence',''))
 return d,''

def get_rows(path):
 if path.suffix.lower()=='.zip':
  with zipfile.ZipFile(path) as z:
   for name in sorted(z.namelist()):
    if name.lower().endswith('.csv') and not name.startswith('__MACOSX'):
     with z.open(name) as b, io.TextIOWrapper(b,encoding='utf-8-sig',errors='replace',newline='') as f:
      sample=f.read(4096);f.seek(0);delimiter='\t' if sample.count('\t')>sample.count(',') else ','
      yield from csv.DictReader(f,delimiter=delimiter)
 else:
  with path.open('r',encoding='utf-8-sig',errors='replace',newline='') as f:
   sample=f.read(4096);f.seek(0);delimiter='\t' if sample.count('\t')>sample.count(',') else ','
   yield from csv.DictReader(f,delimiter=delimiter)

def initial_db(db):
 db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
 CREATE TABLE IF NOT EXISTS source_manifest(source_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, sha256 TEXT NOT NULL, imported_rows INTEGER NOT NULL, eligible_rows INTEGER NOT NULL, skipped_rows INTEGER NOT NULL, missing INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,city TEXT NOT NULL,state TEXT NOT NULL,country TEXT NOT NULL,zip TEXT,chain_suspect INTEGER NOT NULL DEFAULT 0,source_count INTEGER NOT NULL DEFAULT 0,phone_count INTEGER NOT NULL DEFAULT 0,service_labels TEXT NOT NULL DEFAULT '',publication_status TEXT NOT NULL DEFAULT 'REVISION_PENDIENTE');
 CREATE TABLE IF NOT EXISTS observations(source_id TEXT NOT NULL,row_number INTEGER NOT NULL,location_id TEXT NOT NULL,source_type TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',phone_raw TEXT NOT NULL DEFAULT '',service TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '',source_status TEXT NOT NULL DEFAULT '',evidence_json TEXT NOT NULL,PRIMARY KEY(source_id,row_number));
 CREATE INDEX IF NOT EXISTS obs_location_idx ON observations(location_id);
 CREATE TABLE IF NOT EXISTS conflicts(location_id TEXT,conflict_type TEXT,details TEXT,PRIMARY KEY(location_id,conflict_type));
 ''')

def ingest(input_dir,output_dir,published=None,commercial=None):
 output_dir.mkdir(parents=True,exist_ok=True)
 db=sqlite3.connect(output_dir/'st_locations_staging.sqlite')
 initial_db(db)
 # We run cleanly from inputs, deterministically; published references never get overwritten.
 db.execute('DELETE FROM source_manifest');db.execute('DELETE FROM conflicts');db.execute('DELETE FROM observations');db.execute('DELETE FROM locations');db.commit()
 counts=Counter();types=Counter();num_sources=Counter()
 for source,fn in SOURCES.items():
  p=input_dir/fn
  if not p.exists() or p.stat().st_size==0:
   db.execute('INSERT INTO source_manifest VALUES(?,?,?,?,?,?,?)',(source,fn,'',0,0,0,1));continue
  with p.open('rb') as raw:sha=hashlib.file_digest(raw,'sha256').hexdigest()
  seen=eligible=skipped=0
  for n,row in enumerate(get_rows(p),1):
   seen+=1
   d,why=adapt(source,row)
   if not d:skipped+=1;counts[why]+=1;continue
   key='|'.join(norm(d[k]) for k in ('country','state','city','name','address'))
   rid='LOC-'+hashlib.sha256(key.encode()).hexdigest()[:20].upper()
   db.execute('INSERT OR IGNORE INTO locations(id,name,address,city,state,country,zip,chain_suspect) VALUES(?,?,?,?,?,?,?,?)',(rid,d['name'],d['address'],d['city'],d['state'],d['country'],d.get('zip',''),int(d['chain_suspect'])))
   db.execute('UPDATE locations SET chain_suspect=MAX(chain_suspect,?),zip=CASE WHEN zip="" THEN ? ELSE zip END WHERE id=?',(int(d['chain_suspect']),d.get('zip',''),rid))
   meta={k:v for k,v in d.items() if k not in {'name','address','city','state','zip','country','phone','phone_raw','service','source_type','source_url','source_status','chain_suspect'}}
   db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?,?)',(source,n,rid,d['source_type'],d.get('phone',''),d.get('phone_raw',''),d.get('service',''),d.get('source_url',''),d.get('source_status',''),json.dumps(meta,ensure_ascii=False)))
   types[d['source_type']]+=1;eligible+=1
   if n%10000==0:db.commit()
  db.execute('INSERT INTO source_manifest VALUES(?,?,?,?,?,?,?)',(source,fn,sha,seen,eligible,skipped,0))
  db.commit();counts['source_rows']+=seen;counts['eligible_rows']+=eligible
  print(source,'rows',seen,'eligible',eligible,'skipped',skipped,flush=True)
 db.execute('UPDATE locations SET source_count=(SELECT COUNT(DISTINCT source_id) FROM observations WHERE location_id=locations.id),phone_count=(SELECT COUNT(DISTINCT phone) FROM observations WHERE location_id=locations.id AND phone<>"")')
 db.commit()
 # Conflicting valid phone observations are review candidates. No phone alone causes a merge.
 for rid,n in db.execute('SELECT id,phone_count FROM locations WHERE phone_count>1'):
  phones=[p for (p,) in db.execute('SELECT DISTINCT phone FROM observations WHERE location_id=? AND phone<>""',(rid,))]
  db.execute('INSERT OR IGNORE INTO conflicts VALUES(?,?,?)',(rid,'TELEFONOS_DIVERGENTES','; '.join(phones)))
 db.commit()
 # Same address/location but several names: possible alias or unrelated tenant; review but do not merge.
 db.execute('CREATE TEMP TABLE address_keys AS SELECT country,state,city,UPPER(TRIM(address)) AS a,COUNT(*) n FROM locations GROUP BY country,state,city,UPPER(TRIM(address)) HAVING n>1')
 for (rid,n) in db.execute('SELECT l.id,a.n FROM locations l JOIN address_keys a ON l.country=a.country AND l.state=a.state AND l.city=a.city AND UPPER(TRIM(l.address))=a.a'):
  db.execute('INSERT OR IGNORE INTO conflicts VALUES(?,?,?)',(rid,'DOMICILIO_COMPARTIDO',f'{n} identidades distintas en la misma dirección; no fusionar sin evidencia'))
 db.commit()
 # Optional currently published remittance locations in checkout, compare without writing/modifying current catalogue.
 existing_keys=set();commercial_keys=set();repo_published=0;repo_commercial=0
 def repo_keys(path):
  if not path or not Path(path).is_file():return [],0
  try:
   obj=json.loads(Path(path).read_text(encoding='utf-8')); records=obj.get('records',[]) if isinstance(obj,dict) else obj
   if not isinstance(records,list):return [],0
   keys=[]
   for r in records:
    if not isinstance(r,dict):continue
    name=pick(r,'name','business_name','nombre');addr=pick(r,'address','direccion');city=pick(r,'city','ciudad');state=pick(r,'state','estado');c=country(pick(r,'country','pais'),state)
    if all([name,addr,city,state]):keys.append('|'.join(norm(z) for z in (c,state,city,name,addr)))
   return keys,len(records)
  except (OSError,ValueError,TypeError) as e:print('WARN repo reference',str(e));return [],0
 keys,repo_published=repo_keys(published);existing_keys.update(keys)
 keys,repo_commercial=repo_keys(commercial);commercial_keys.update(keys)
 # NOTE: commercial contacts are not published remittance agents.
 report={'schema_version':SCHEMA_VERSION,'date_utc':datetime.now(timezone.utc).isoformat(),'source_file_rows':counts['source_rows'],'eligible_observations':counts['eligible_rows'],'unique_candidates':db.execute('SELECT COUNT(*) FROM locations').fetchone()[0],'suspected_chain_locations':db.execute('SELECT COUNT(*) FROM locations WHERE chain_suspect=1').fetchone()[0],'locations_with_any_phone':db.execute('SELECT COUNT(*) FROM locations WHERE phone_count>0').fetchone()[0],'locations_with_multiple_phones':db.execute('SELECT COUNT(*) FROM locations WHERE phone_count>1').fetchone()[0],'address_collision_locations':db.execute("SELECT COUNT(*) FROM conflicts WHERE conflict_type='DOMICILIO_COMPARTIDO'").fetchone()[0],'sources':{},'skipped_reasons':dict(counts),'source_types_observations':dict(types),'repo_references':{'published_remittance_rows':repo_published,'general_commercial_rows':repo_commercial,'published_reference_loaded':bool(existing_keys),'commercial_reference_loaded':bool(commercial_keys)}}
 for s,f,sha,n,e,sk,miss in db.execute('SELECT * FROM source_manifest ORDER BY source_id'):
  report['sources'][s]={'file_name':f,'sha256':sha,'rows':n,'eligible':e,'excluded':sk,'missing':bool(miss)}
 outcsv=output_dir/'candidatos_enriquecidos_NO_PUBLICAR.csv'
 with outcsv.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['id','nombre','direccion','ciudad','estado','pais','zip','telefonos_sin_verificar','operadores_o_indicios','cadenas_sospechosas','fuentes_distintas','total_observaciones','publicado_remesas_repositorio','coincide_directorio_comercial','estado_publicacion','motivos_revision','fuentes'])
  per_location={}
  for lid,srcs,phones,services,n in db.execute('SELECT location_id,GROUP_CONCAT(DISTINCT source_id),GROUP_CONCAT(DISTINCT phone),GROUP_CONCAT(DISTINCT service),COUNT(*) FROM observations GROUP BY location_id'):
   per_location[lid]=(sorted(set(filter(None,(phones or '').split(',')))),sorted(set(filter(None,(services or '').split(',')))),sorted(set(filter(None,(srcs or '').split(',')))),n)
  conflicts=defaultdict(list)
  for lid,typ in db.execute('SELECT location_id,conflict_type FROM conflicts'):conflicts[lid].append(typ)
  cur=db.execute('SELECT id,name,address,city,state,country,zip,chain_suspect,source_count FROM locations ORDER BY id')
  for rid,name,address,city,state,c,zip_,chain,sc in cur:
   phones,services,sources,n=per_location.get(rid,([],[],[],0))
   reasons=conflicts.get(rid,[]).copy()
   if chain:reasons.append('POSIBLE_CADENA')
   key='|'.join(norm(x) for x in (c,state,city,name,address))
   inpub=int(key in existing_keys) if existing_keys else ''
   incom=int(key in commercial_keys) if commercial_keys else ''
   w.writerow([rid,name,address,city,state,c,zip_,'; '.join(phones),'; '.join(services),'SI' if chain else 'NO',sc,n,inpub,incom,'REVISION_PENDIENTE', '; '.join(sorted(reasons)),'; '.join(sources)])
 if existing_keys:
  report['repo_references']['candidate_exact_matches_published']=sum(1 for r in csv.DictReader(outcsv.open(encoding='utf-8-sig')) if r['publicado_remesas_repositorio']=='1')
 if commercial_keys:
  report['repo_references']['candidate_exact_matches_commercial']=sum(1 for r in csv.DictReader(outcsv.open(encoding='utf-8-sig')) if r['coincide_directorio_comercial']=='1')
 with (output_dir/'revision_conflictos.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['id','tipo_conflicto','detalle']);w.writerows(db.execute('SELECT * FROM conflicts ORDER BY conflict_type,location_id'))
 (output_dir/'reporte_conciliacion.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 with (output_dir/'manifest_fuentes.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['fuente','archivo','sha256','filas','elegibles','excluidas','no_disponible']);w.writerows(db.execute('SELECT * FROM source_manifest ORDER BY source_id'))
 db.commit();db.close();print('DONE',json.dumps({k:report[k] for k in ('source_file_rows','eligible_observations','unique_candidates','suspected_chain_locations','locations_with_any_phone','locations_with_multiple_phones','address_collision_locations')}))
 return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input-dir',default='input');p.add_argument('--output-dir',default='output');p.add_argument('--published',default=None);p.add_argument('--commercial',default=None)
 a=p.parse_args();ingest(Path(a.input_dir),Path(a.output_dir),a.published,a.commercial)