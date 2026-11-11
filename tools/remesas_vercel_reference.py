#!/usr/bin/env python3
"""Fetch the currently deployed ST Remesas catalogue as a *private* CI reference.

No records from this snapshot are committed, uploaded to CI artifacts, or
published. Any partial or malformed fetch fails closed. The app deployed at
st-remesas.vercel.app currently fetches /data/000.txt ... /data/026.txt and
concatenates their bytes before JSON.parse. Do not treat the older GitHub
Pages catalogue as the Vercel production baseline.
"""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

PRODUCTION_ORIGIN = 'https://st-remesas.vercel.app'
PRODUCTION_PROJECT = 'prj_6oKmNWNrV1VIlZHVYbNaBroJGTiH'
PARTS = 27
MAX_PART_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 80 * 1024 * 1024


def load_public_snapshot(fetch=None, origin=PRODUCTION_ORIGIN, parts=PARTS):
    """Return (full validated JSON, sha256); fetch is injectable for offline tests."""
    if origin != PRODUCTION_ORIGIN:
        raise ValueError('Source must be the verified ST Remesas production origin')
    if parts != PARTS:
        raise ValueError('Unexpected ST Remesas chunk count; inspect live site before changing')
    if fetch is None:
        def fetch(url):
            request=Request(url, headers={'User-Agent':'ST-Remesas-Audit/1.0 (read-only)', 'Accept':'text/plain'})
            with urlopen(request, timeout=25) as response:
                if getattr(response,'status',200) != 200:
                    raise OSError('Unexpected HTTP status')
                body=response.read(MAX_PART_BYTES + 1)
                return body
    payload = bytearray()
    for index in range(parts):
        url=f'{origin}/data/{index:03d}.txt'
        chunk=fetch(url)
        if not isinstance(chunk, bytes) or not chunk or len(chunk)>MAX_PART_BYTES:
            raise ValueError(f'Invalid/oversized reference part {index:03d}')
        payload.extend(chunk)
        if len(payload) > MAX_TOTAL_BYTES:
            raise ValueError('ST Remesas snapshot exceeds configured safety limit')
    sha=hashlib.sha256(payload).hexdigest()
    try:
        obj=json.loads(payload.decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('Incomplete/invalid ST Remesas JSON; no reconciliation allowed') from exc
    if not isinstance(obj,dict) or not isinstance(obj.get('records'),list):
        raise ValueError('ST Remesas JSON must have a records array')
    rows=obj['records']
    if not rows or not all(isinstance(r,dict) for r in rows):
        raise ValueError('Empty or malformed live catalogue')
    ids=[r.get('id') for r in rows]
    if any(not isinstance(x,str) or not x.strip() for x in ids) or len(set(ids)) != len(ids):
        raise ValueError('Missing or duplicated public IDs: block reconciliation')
    return obj,sha


def run(out):
    obj,sha=load_public_snapshot()
    out=Path(out)
    out.parent.mkdir(parents=True,exist_ok=True)
    # Avoid partial baseline files, and keep downloaded personal details private.
    fd,tmp=tempfile.mkstemp(prefix='.st-remesas-',suffix='.json',dir=out.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            json.dump(obj,f,ensure_ascii=False,separators=(',',':'))
        os.replace(tmp,out)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
    summary={'status':'REFERENCE_READY','origin':PRODUCTION_ORIGIN,'project_id':PRODUCTION_PROJECT,
             'chunks':PARTS,'records':len(obj['records']),'sha256':sha,
             'automatic_publication':False}
    print(json.dumps(summary,ensure_ascii=False,sort_keys=True))
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--out',default='/tmp/st-locations-reconciliation/st-remesas-live.json')
    a=p.parse_args()
    run(a.out)