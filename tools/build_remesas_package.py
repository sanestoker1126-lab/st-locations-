#!/usr/bin/env python3
"""Generate a self-contained remittance finder and complete catalogue ZIP."""
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release-remesas"
OUT.mkdir(exist_ok=True)
STAMP = "2026-11-07"

def read(path):
    return (ROOT / path).read_text(encoding="utf-8")

def replace_one(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected one match for {old[:60]!r}: got {text.count(old)}")
    return text.replace(old, new)

def json_script(text):
    return text.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

def build_html():
    original = read("data/locations.json")
    data = json.loads(original)
    rows = data["records"]
    if not rows or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Invalid remittance list or duplicate IDs")
    html = read("buscador.html")
    search = read("buscador.js")
    geo = read("remesas-map.js")
    search = replace_one(search, 'fetch("/st-locations-/data/locations.json")',
                         'Promise.resolve({ok:true,json:async()=>JSON.parse(document.getElementById("offline-data").textContent)})')
    search = replace_one(search, 'fetch("/st-locations-/data/state-priorities.json")',
                         'Promise.resolve({ok:true,json:async()=>JSON.parse(document.getElementById("offline-priorities").textContent)})')
    search = replace_one(search, "  function saveURL() {\n",
                         '  function saveURL() {\n    if (location.protocol === "file:") return;\n')
    geo = replace_one(geo, 'const base = new URL("./", document.currentScript.src);',
                      'const base = new URL("./", document.baseURI);')
    geo = replace_one(geo, 'fetch(new URL("data/remesas-geopoints.json", base), { cache: "no-cache" })',
                      'Promise.resolve({ok:true,json:async()=>JSON.parse(document.getElementById("offline-geopoints").textContent)})')
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', "", html)
    for stylesheet in ("buscador.css", "remesas-map.css"):
        html = replace_one(html, f'<link rel="stylesheet" href="/st-locations-/{stylesheet}" />',
                           "<style>\n" + read(stylesheet) + "\n</style>")
    for script in ("buscador.js", "remesas-map.js"):
        html = replace_one(html, f'<script src="/st-locations-/{script}" defer></script>', "")
    leaflet = re.search(r'<script src="https://cdn\.jsdelivr\.net/npm/leaflet@1\.9\.4/dist/leaflet\.js"[^>]*></script>', html)
    if not leaflet:
        raise ValueError("Missing map dependency")
    leaflet_script = leaflet.group(0).replace(" defer", "")
    html = replace_one(html, leaflet.group(0), "")
    html = html.replace('href="/st-locations-/', 'href="https://sanestoker1126-lab.github.io/st-locations-/')
    html = replace_one(html, '<body class="premium-remesas">',
        f'<body class="premium-remesas"><div class="offline-banner" role="note">Versión autónoma · {len(rows)} fichas de remesas · búsqueda sin Internet. El mapa necesita conexión.</div>')
    html = replace_one(html, "</head>", '<style>.offline-banner{padding:9px 18px;text-align:center;background:#0b2330;color:#b9f7e2;font-size:12px;border-bottom:1px solid #234b5a}</style>\n</head>')
    for script in (search, geo):
        if "</script" in script.lower():
            raise ValueError("Unsafe script close")
    inject = ('\n<script id="offline-data" type="application/json">' + json_script(original) + '</script>\n'
              + '<script id="offline-priorities" type="application/json">' + json_script(read("data/state-priorities.json")) + '</script>\n'
              + '<script id="offline-geopoints" type="application/json">' + json_script(read("data/remesas-geopoints.json")) + '</script>\n'
              + leaflet_script + '\n<script>\n' + search + '\n</script>\n<script>\n' + geo + '\n</script>\n')
    html = replace_one(html, "</body>", inject + "</body>")
    target = OUT / f"Punto_Envios_Remesas_{len(rows)}_Autonomo.html"
    target.write_text(html, encoding="utf-8")
    return target, len(rows), sum(bool(r.get("phone")) for r in rows)

def build_zip(standalone, n, nphones):
    total = json.loads(read("data/interface-release.json"))["dataset_counts"]["total_records"]
    if total != 417496:
        raise ValueError(f"Unexpected total records: {total}")
    intake = ROOT / "data/intake/remesas_usa_2026-11-06"
    audit = json.loads((intake / "auditoria.json").read_text(encoding="utf-8"))
    manifest = {
        "edition": STAMP, "remittance_published": n, "remittance_with_published_phone": nphones,
        "commercial_records": total, "staged_candidates_not_validated": audit["staged_for_validation"],
        "current_phone_verifications": audit["current_phone_verifications"],
        "notes": ["Commercial catalogue entries are NOT necessarily remittance agents.",
                  "Remittance phone numbers and services require current verification.",
                  "Review candidates and possible duplicates have NOT been published.",
                  "No coordinates have been invented."]
    }
    (OUT / "MANIFIESTO_REGISTROS.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "LEEME.txt").write_text(
        f"Punto Envíos · entrega {STAMP}\n\n"
        f"Abre {standalone.name} con el navegador. Los {n} registros de remesas están incluidos en el HTML, sin servidor.\n"
        "El minimapa y la geocodificación individual requieren conexión a Internet.\n\n"
        "datos/remesas_publicadas_4499.json: registros completos con evidencia.\n"
        "datos/base_comercial_417496.json: directorio general (NO todos son agentes de remesas).\n"
        "datos/historicos.json: contactos de documentos históricos, separados.\n"
        "datos/pendientes_revision/: candidatos, posibles duplicados, exclusiones y auditoría, NO verificados.\n\n"
        "Las cifras no acreditan que los teléfonos estén actualmente activos. No se han inventado teléfonos ni coordenadas.\n",
        encoding="utf-8")
    dest = OUT / f"Punto_Envios_HTML_y_Registros_Completos_{STAMP}.zip"
    entries = {
        "data/locations.json": "datos/remesas_publicadas_4499.json",
        "data/master-contacts.json": "datos/base_comercial_417496.json",
        "data/historical-document-contacts.json": "datos/historicos.json",
        "data/master-phone-review.json": "datos/revision_telefonos.json",
        "data/platform-sources.json": "datos/fuentes_plataformas.json",
        "data/source-manifest.json": "datos/manifiesto_fuentes.json",
        "data/remesas-geopoints.json": "datos/coordenadas_validadas.json",
    }
    with ZipFile(dest, "w", compression=ZIP_DEFLATED, compresslevel=7, allowZip64=True) as z:
        for file in (standalone, OUT / "LEEME.txt", OUT / "MANIFIESTO_REGISTROS.json"):
            z.write(file, file.name)
        for original, target in entries.items():
            z.write(ROOT / original, target)
        for path in sorted(intake.rglob("*")):
            if path.is_file():
                z.write(path, "datos/pendientes_revision/" + str(path.relative_to(intake)))
    return dest

if __name__ == "__main__":
    standalone, n, nphones = build_html()
    zipfile = build_zip(standalone, n, nphones)
    for path in (standalone, zipfile):
        print(f"{path.name}: {path.stat().st_size} bytes SHA256={hashlib.sha256(path.read_bytes()).hexdigest()}")
