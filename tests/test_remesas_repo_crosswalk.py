import csv,json,tempfile,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from remesas_repo_crosswalk import reconcile

class RepoCrosswalkTests(unittest.TestCase):
 def test_overlap_conservative_three_cases(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);pub=p/'published.json';csvfile=p/'candidates.csv'
   pub.write_text(json.dumps({'records':[
    {'id':'A','name':'Tienda Uno','address':'1 Main St','city':'Houston','state':'TX','country':'US','phone':'7134443333','providers':['Barri']},
    {'id':'B','name':'Pharma Different','address':'9 River Ave','city':'Houston','state':'TX','country':'US','phone':'8325559999'}]}))
   fields=['id','nombre','direccion','ciudad','estado','pais','telefonos_sin_verificar','fuentes']
   data=[['X1','Tienda Uno','1 Main St','Houston','Texas','US','7134443333','foo'],
         ['X2','Other Business','9 River Ave','Houston','TX','US','','foo'],
         ['X3','Elsewhere','101 Other St','Houston','TX','US','8325559999','foo'],
         ['X4','Unmatched','200 West','Dallas','TX','US','','foo']]
   with csvfile.open('w',newline='') as f:
    w=csv.writer(f);w.writerow(fields);w.writerows(data)
   r=reconcile(csvfile,pub,p/'output')
   self.assertEqual(r['coincidencia_exacta_candidatos'],1)
   self.assertEqual(r['misma_direccion_ambiguos'],1)
   self.assertEqual(r['telefono_compartido_ambiguos'],1)
   self.assertEqual(r['sin_coincidencia'],1)
   self.assertEqual(r['publicaciones_automaticas'],0)
if __name__=='__main__':unittest.main()