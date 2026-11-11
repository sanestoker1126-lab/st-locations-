import json,os,subprocess,sys,tempfile,unittest
from pathlib import Path

SRC=Path(__file__).resolve().parents[1]
class CIStatusTests(unittest.TestCase):
 def test_empty_source_set_blocks_report_and_pr(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t); tools=root/'tools'; tools.mkdir()
   for name in ('remesas_reconcile.py','remesas_reconcile_ci.py','remesas_repo_crosswalk.py'):
    (tools/name).write_bytes((SRC/'tools'/name).read_bytes())
   output=root/'github_output'
   env=dict(os.environ, GITHUB_OUTPUT=str(output))
   r=subprocess.run([sys.executable,str(tools/'remesas_reconcile_ci.py')],env=env,capture_output=True,text=True,timeout=20)
   self.assertEqual(r.returncode,0,r.stderr)
   status=json.loads((root/'data/staging/reconciliation_report.json').read_text())
   self.assertEqual(status['status'],'BLOCKED_NO_INPUTS')
   self.assertEqual(status['source_snapshot_count'],0)
   self.assertIn('has_sources=false',output.read_text())
   self.assertFalse((root/'data/staging/remesas_sources').exists())
 def test_workflow_never_commits_raw_contacts(self):
  workflow=(SRC/'.github/workflows/remesas-reconciliation.yml').read_text()
  section=workflow.split('add-paths:',1)[1]
  self.assertIn('data/staging/reconciliation_report.json',section)
  self.assertNotIn('remesas_sources',section)
if __name__=='__main__':unittest.main()