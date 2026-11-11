import csv,json,tempfile,unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from remesas_reconcile import adapt,country,phone,norm,ingest
class ReconciliationTests(unittest.TestCase):
 def test_telephone_requires_plausible_us_number(self):
  self.assertEqual(phone('(713) 988-7474'),'+17139887474')
  self.assertEqual(phone('0000000000'),'')
  self.assertEqual(phone('1234567890'),'')
 def test_fincen_409_only(self):
  base={'LEGAL NAME':'A','STREET ADDRESS':'1 Elm St','CITY':'Miami','STATE':'FL','ZIP':'33101'}
  self.assertIsNone(adapt('fincen_msb_20261110',{**base,'MSB ACTIVITIES':'401 402'})[0])
  d,err=adapt('fincen_msb_20261110',{**base,'MSB ACTIVITIES':'401 409'});self.assertEqual(d['source_type'],'regulatory_entity')
 def test_stable_normalization(self):
  self.assertEqual(norm('José & Sons LLC'),'JOSE SONS LLC')
  self.assertEqual(country('Canada','Ontario'),'CA')
 def test_reconcile_preserves_sources_and_no_publication(self):
  with tempfile.TemporaryDirectory() as t:
   inp=Path(t)/'input';out=Path(t)/'output';inp.mkdir()
   with (inp/'registro_unico_candidatos_remesas_2026_11_10.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['nombre','direccion','ciudad','estado','pais','telefono_origen_sin_revalidar']);w.writeheader();w.writerow({'nombre':'Tienda A','direccion':'11 E Main','ciudad':'El Paso','estado':'TX','pais':'US','telefono_origen_sin_revalidar':'+1 915 555 0134'})
   r=ingest(inp,out);self.assertEqual(r['unique_candidates'],1)
   with (out/'candidatos_enriquecidos_NO_PUBLICAR.csv').open(encoding='utf-8-sig') as f:
    rows=list(csv.DictReader(f))
   self.assertEqual(rows[0]['estado_publicacion'],'REVISION_PENDIENTE')
   self.assertTrue(rows[0]['fuentes'])
if __name__=='__main__':unittest.main()