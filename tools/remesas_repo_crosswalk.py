#!/usr/bin/env python3
"""Conservative, read-only crosswalk of an offline published remittance snapshot.

Identifies exact location/name matches, shared addresses, and shared local phone
numbers without automatic merges or phone-service verification.
"""
import argparse,csv,json,re,hashlib
from collections import defaultdict,Counter
from pathlib import Path
from html import unescape
from remesas_reconcile import norm,phone,country,STATES

OFFLINE_RE = re.compile(r'<script\s+id="offline-data"\s+type="application/json">(.*?)</script>',re.S|re.I)

def parse_published(path):
    """Read either a historical self-contained HTML or the current repository JSON."""
    if str(path).lower().endswith(".json"):
        obj=json.loads(Path(path).read_text(encoding="utf-8"))
        rows=obj.get("records",[]) if isinstance(obj,dict) else obj
        if not isinstance(rows,list): raise ValueError("records not list")
        return rows,(obj.get("metadata",{}) if isinstance(obj,dict) else {})
    return parse_offline_html(path)

def parse_offline_html(path):
    content=Path(path).read_text(encoding='utf-8',errors='replace')
    match=OFFLINE_RE.search(content)
    if not match: raise ValueError('offline-data not found')
    obj=json.loads(match.group(1))
    rows=obj.get('records')
    if not isinstance(rows,list): raise ValueError('records not list')
    return rows, obj.get('metadata',{})

def key_parts(row,local=False):
    if local:
        name=row.get('nombre',''); address=row.get('direccion','');city=row.get('ciudad',''); state=row.get('estado',''); c=row.get('pais','US')
    else:
        name=row.get('name','');address=row.get('address','');city=row.get('city','');state=row.get('state','');c=row.get('country','US')
    state=STATES.get(norm(state),norm(state))
    c=country(c,state)
    return c,state,norm(city),norm(name),norm(address)

def tokens(row):
    vals=[]
    if 'telefonos_sin_verificar' in row:
        vals=row['telefonos_sin_verificar'].split(';')
    else:
        vals=[row.get('phone','')]+row.get('alternate_phones',[])
    return {p for v in vals if (p:=phone(v))}

def reconcile(csv_path,html_path,out_dir):
    out_dir=Path(out_dir);out_dir.mkdir(exist_ok=True,parents=True)
    pub,metadata=parse_published(html_path)
    exact=defaultdict(list);places=defaultdict(list);ph=defaultdict(list)
    pubby={}
    for i,r in enumerate(pub):
        tup=key_parts(r);pubby[i]=r
        exact[tup].append(i);places[(tup[0],tup[1],tup[2],tup[4])].append(i)
        for p in tokens(r):ph[(tup[0],tup[1],tup[2],p)].append(i)
    rows=[]; counts=Counter();pairs=set(); totals=0
    with Path(csv_path).open(encoding='utf-8-sig',newline='') as f:
        for cand in csv.DictReader(f):
            totals+=1
            k=key_parts(cand,True)
            eid=exact.get(k,[])
            addr=places.get((k[0],k[1],k[2],k[4]),[])
            phit=set()
            for p in tokens(cand):phit.update(ph.get((k[0],k[1],k[2],p),[]))
            same_address=[i for i in addr if i not in eid]
            phone_only=[i for i in sorted(phit) if i not in eid and i not in same_address]
            if eid:klass='EXACTA_NOMBRE_DIRECCION'
            elif same_address:klass='MISMO_DOMICILIO_REVISAR'
            elif phone_only:klass='MISMO_TELEFONO_REVISAR'
            else:klass='SIN_COINCIDENCIA_DETECTADA'
            counts[klass]+=1
            matched=(eid or same_address or phone_only)
            if not matched:continue
            for i in matched:
                r=pubby[i]
                relation='NOMBRE_Y_DOMICILIO_EXACTOS' if i in eid else ('DOMICILIO_COMPARTIDO' if i in same_address else 'TELEFONO_COMPARTIDO')
                if (cand['id'],i) in pairs:continue
                pairs.add((cand['id'],i))
                rows.append({'candidate_id':cand['id'],'candidate_name':cand['nombre'],'candidate_address':cand['direccion'],'candidate_city':cand['ciudad'],'candidate_state':cand['estado'],'candidate_country':cand['pais'],'published_id':r.get('id',''),'published_name':r.get('name',''),'published_address':r.get('address',''),'published_phone_snapshot':r.get('phone',''),'published_providers_snapshot':'; '.join(map(str,r.get('providers',[]))),'published_observed_at':r.get('contact_observed_at',''),'relation':relation,'current_candidate_sources':cand.get('fuentes',''),'requires_human_review':'REVISION_SERVICIO_Y_TELEFONO' if relation=='NOMBRE_Y_DOMICILIO_EXACTOS' else 'REVISION_IDENTIDAD_SERVICIO_Y_TELEFONO','note':'Snapshot historico; no certifica negocio, operador ni telefono vigente'})
    dest=out_dir/'cruce_publicado_sin_autofusion_REVISION.csv'
    with dest.open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]) if rows else ['candidate_id','published_id','relation']);writer.writeheader();writer.writerows(rows)
    report={'snapshot_publicado_observado':len(pub),'candidatos_examinados':totals,'coincidencia_exacta_candidatos':counts['EXACTA_NOMBRE_DIRECCION'],'misma_direccion_ambiguos':counts['MISMO_DOMICILIO_REVISAR'],'telefono_compartido_ambiguos':counts['MISMO_TELEFONO_REVISAR'],'sin_coincidencia':counts['SIN_COINCIDENCIA_DETECTADA'],'pares_en_cruce':len(rows),'metadata_declarada':{'updated_at':metadata.get('updated_at'),'source_observed_at':metadata.get('source_observed_at')},'referencia':'Instantanea de catalogo aportada (HTML historico o JSON del checkout); no verificacion actual','publicaciones_automaticas':0}
    (out_dir/'resumen_cruce_publicado.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidates',required=True);p.add_argument('--published-snapshot',required=True);p.add_argument('--output-dir',required=True);a=p.parse_args();reconcile(a.candidates,a.published_snapshot,a.output_dir)