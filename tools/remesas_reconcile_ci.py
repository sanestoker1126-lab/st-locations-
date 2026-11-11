#!/usr/bin/env python3
"""Non-destructive report for scheduled checks. Does not edit public data."""
import json,sys
from pathlib import Path
from remesas_reconcile import ingest

def main():
 root=Path(__file__).resolve().parents[1]
 data=root/'data/staging/remesas_sources'
 results=Path('/tmp/st-locations-reconciliation')
 r=ingest(data,results,root/'data/locations.json',root/'data/master-contacts.json')
 keep={key:val for key,val in r.items() if key!='date_utc'}
 out=root/'data/staging/reconciliation_report.json';out.parent.mkdir(parents=True,exist_ok=True)
 out.write_text(json.dumps(keep,ensure_ascii=False,indent=2,sort_keys=True)+'\n',encoding='utf-8')
 if not any(not v['missing'] for v in r['sources'].values()):
  print('AVISO: no hay snapshots de Biblioteca/Drive en data/staging/remesas_sources; la tarea no cruza fuentes externas.')
 print('Propuesta de conciliación escrita sin tocar los registros públicos.')
if __name__=='__main__':main()