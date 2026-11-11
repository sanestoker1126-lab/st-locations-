#!/usr/bin/env python3
"""Read-only reconciliation of staged inputs against repository references.

Do not commit/export raw snapshots, personal contact details, or collisions to public Git.
Scheduled runs with no sources report BLOCKED_NO_INPUTS rather than a fictitious zero-result merge.
"""
import json, os
from pathlib import Path
from remesas_reconcile import ingest, SOURCES
from remesas_repo_crosswalk import reconcile as crosswalk

def main():
    root=Path(__file__).resolve().parents[1]
    input_dir=root/'data/staging/remesas_sources'
    work_dir=Path('/tmp/st-locations-reconciliation')
    work_dir.mkdir(parents=True,exist_ok=True)
    report_path=root/'data/staging/reconciliation_report.json'
    report_path.parent.mkdir(parents=True,exist_ok=True)
    available=[(source,filename) for source,filename in SOURCES.items() if (input_dir/filename).is_file() and (input_dir/filename).stat().st_size>0]
    summary={'schema_version':2,'status':'BLOCKED_NO_INPUTS','has_source_snapshots':bool(available),'source_snapshot_count':len(available),'input_roster_expected':len(SOURCES),'personal_data_published':False,'automatic_publication':False}
    if not available:
        print('BLOCKED_NO_INPUTS: Drive/Biblioteca/regulatorios no disponibles. No se declara conciliación realizada.')
    else:
        result=ingest(input_dir,work_dir,root/'data/locations.json',root/'data/master-contacts.json')
        summary.update({k:v for k,v in result.items() if k!='date_utc'})
        summary['status']='STAGING_READY' if result['repo_references']['published_reference_loaded'] and result['repo_references']['commercial_reference_loaded'] else 'INCOMPLETE_GITHUB_REFERENCE'
        reference=root/'data/locations.json'
        if reference.is_file() and (work_dir/'candidatos_enriquecidos_NO_PUBLICAR.csv').is_file():
            try:
                overlaps=crosswalk(work_dir/'candidatos_enriquecidos_NO_PUBLICAR.csv',reference,work_dir)
                summary['published_overlap']={k:v for k,v in overlaps.items() if k not in ('metadata_declarada','referencia')}
            except (OSError,ValueError,KeyError,TypeError) as exc:
                print('WARN: current-published crosswalk incomplete:',type(exc).__name__,str(exc))
                summary['published_overlap_error']=type(exc).__name__
                summary['status']='INCOMPLETE_GITHUB_REFERENCE'
        # Record only aggregate source metadata in public staging report; no raw contacts.
    report_path.write_text(json.dumps(summary,ensure_ascii=False,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    (work_dir/'estado_operacion.json').write_text(json.dumps({'status':summary['status'],'available_sources':[x[0] for x in available],'expected_sources':len(SOURCES),'no_publication':True},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as file:
            file.write('has_sources='+('true' if available else 'false')+'\n')
            file.write('status='+summary['status']+'\n')
    print('Result:',summary['status'],'snapshots:',len(available),'of',len(SOURCES))
    return summary

if __name__=='__main__':main()