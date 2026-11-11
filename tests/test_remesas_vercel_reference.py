import json
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from remesas_vercel_reference import load_public_snapshot, PRODUCTION_ORIGIN, PARTS

class VercelReferenceTests(unittest.TestCase):
    def sample_fetch(self, data):
        raw=json.dumps(data,ensure_ascii=False).encode('utf-8')
        # Make precisely 27 segments, each nonempty; test with long payload
        raw+=b' '*(PARTS*2)
        step=len(raw)//PARTS
        chunks=[raw[i*step:(i+1)*step] for i in range(PARTS-1)]
        chunks.append(raw[(PARTS-1)*step:])
        self.assertEqual(len(chunks), PARTS)
        return lambda url: chunks[int(url.rsplit('/',1)[-1].split('.')[0])]

    def test_valid_snapshot(self):
        obj={'metadata':{'updated_at':'2026-11-10'},'records':[{'id':'US-1','name':'Tienda A','address':'1 Main St'}]}
        parsed, sha=load_public_snapshot(fetch=self.sample_fetch(obj))
        self.assertEqual(parsed['records'][0]['id'],'US-1')
        self.assertEqual(len(sha),64)
    def test_duplicate_id_fails_closed(self):
        obj={'records':[{'id':'US-1'},{'id':'US-1'}]}
        with self.assertRaisesRegex(ValueError,'duplicated'):
            load_public_snapshot(fetch=self.sample_fetch(obj))
    def test_empty_part_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'Invalid/oversized'):
            load_public_snapshot(fetch=lambda u:b'')
    def test_wrong_domain_rejected(self):
        with self.assertRaisesRegex(ValueError,'verified'):
            load_public_snapshot(fetch=lambda u:b'{}',origin='https://another.vercel.app')
    def test_malformed_json_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'Incomplete/invalid'):
            load_public_snapshot(fetch=lambda u:b'{not valid')

if __name__=='__main__': unittest.main()

class VercelProductionGuardTests(unittest.TestCase):
    def test_inputs_without_vercel_reference_are_blocked(self):
        import os, subprocess, tempfile
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            tools=root/'tools';tools.mkdir()
            original=Path(__file__).resolve().parents[1]/'tools'
            for name in ('remesas_reconcile.py','remesas_reconcile_ci.py','remesas_repo_crosswalk.py'):
                (tools/name).write_bytes((original/name).read_bytes())
            folder=root/'data/staging/remesas_sources'; folder.mkdir(parents=True)
            (folder/'registro_unico_candidatos_remesas_2026_11_10.csv').write_text('id,nombre,direccion\n1,Tienda,Principal 1\n',encoding='utf-8')
            output=root/'github_output'
            env=dict(os.environ,GITHUB_OUTPUT=str(output))
            run=subprocess.run([sys.executable,str(tools/'remesas_reconcile_ci.py')],env=env,text=True,capture_output=True,timeout=10)
            self.assertEqual(run.returncode,0,run.stderr)
            report=json.loads((root/'data/staging/reconciliation_report.json').read_text())
            self.assertEqual(report['status'],'BLOCKED_VERCEL_REFERENCE')
            self.assertFalse(report['automatic_publication'])
            self.assertIn('status=BLOCKED_VERCEL_REFERENCE',output.read_text())