#!/usr/bin/env python3
"""Optional GitHub Actions Google Sheets bridge; requires an authorized service account.
Never writes to Drive. Credentials must be stored only in an Actions secret.
"""
import argparse, csv, json, os, sys
from pathlib import Path

SHEET_ID='1pyEoGF1mZzQKQWu7wE3CaDCU18xpqakTj6MWJNwafPw'
RANGES={
 'Drive_Base_Maestra.csv':"'Base Maestra'!A1:S",
 'Drive_Agentes_Confirmados.csv':"'Agentes Confirmados'!A1:L",
}

def run(dest):
 raw=os.environ.get('ST_LOCATIONS_GOOGLE_SERVICE_ACCOUNT_JSON','')
 if not raw:
  print('Drive sync skipped: no service-account secret configured.')
  return False
 try:
  from google.oauth2 import service_account
  from google.auth.transport.requests import AuthorizedSession
  credentials=service_account.Credentials.from_service_account_info(json.loads(raw),scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
  session=AuthorizedSession(credentials)
  dest.mkdir(parents=True,exist_ok=True)
  for name,a1 in RANGES.items():
   from urllib.parse import quote
   url=f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{quote(a1,safe="")}'
   r=session.get(url,params={'valueRenderOption':'FORMATTED_VALUE'},timeout=60)
   r.raise_for_status()
   rows=r.json().get('values',[])
   if not rows:raise RuntimeError(f'Empty authorized sheet: {name}')
   n=len(rows[0]);
   with (dest/name).open('w',encoding='utf-8-sig',newline='') as f:
    csv.writer(f).writerows([(row+['']*n)[:n] for row in rows])
   print(f'Updated Drive snapshot: {name} ({max(0,len(rows)-1)} data rows)')
  return True
 except Exception as e:
  print('Drive sync ERROR (staging unchanged for failed sheet):',str(e),file=sys.stderr)
  raise
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input-dir',default='data/staging/remesas_sources');args=p.parse_args()
 run(Path(args.input_dir))