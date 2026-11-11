# ST Locations — sistema de conciliación continua (staging)

## Qué hace realmente

1. Normaliza nombres, direcciones, teléfonos y jurisdicciones; crea IDs reproducibles para registros candidatos.
2. Cruza archivos locales de remesas/estados, capturas de Google Sheets y FinCEN MSB (solo código de actividad **409**).
3. Conserva la evidencia original por fila en SQLite; separa empresa registrada, sede/establecimiento, agente declarado y captura sin comprobar.
4. Señala cadenas, teléfonos contradictorios y direcciones compartidas. Un teléfono compartido **nunca** causa fusión automática.
5. Cruza los candidatos con `data/locations.json` y `data/master-contacts.json` si están disponibles en el checkout de GitHub.
6. Genera informe estable en `data/staging/reconciliation_report.json`, artefactos de auditoría y, cuando hay cambios, un PR para revisión.

## Fuentes y autorización

- **GitHub**: la ejecución de Actions usa el catálogo actual en `main`; jamás modifica los archivos publicados.
- **Drive**: para actualizar de forma recurrente, crea una cuenta de servicio Google con acceso solo lectura, comparte únicamente la hoja [maestra](https://docs.google.com/spreadsheets/d/1pyEoGF1mZzQKQWu7wE3CaDCU18xpqakTj6MWJNwafPw/edit) con esa cuenta y guarda su JSON en el secreto de Actions `ST_LOCATIONS_GOOGLE_SERVICE_ACCOUNT_JSON`. Sin el secreto, se omite Drive. No se usa ningún token personal guardado en código.
- **Biblioteca ChatGPT**: los archivos están disponibles en el chat, no automáticamente en GitHub Actions; exporta sus snapshots CSV hacia `data/staging/remesas_sources/` o realiza el traspaso mediante un proceso autorizado. No fingimos sincronización directa.
- **Fuentes regulatorias y comerciales**: solo se cargan descargas obtenidas legalmente y de procedencia documentada; una licencia vigente no certifica por sí sola teléfono, actividad actual ni independencia.

## Ejecución local

```bash
python tools/remesas_reconcile.py --input-dir input --output-dir output \
  --published data/locations.json --commercial data/master-contacts.json
python -m unittest discover -s tests -p 'test_reconcile.py' -v
```

Los archivos aceptados están definidos en `SOURCES` dentro de `tools/remesas_reconcile.py`; otras hojas y datos auxiliares **no se cuentan** como negocios por defecto. Los informes distinguen observaciones, identidades y registros publicables (cero altas automáticas).

## Activación automática

El flujo `.github/workflows/remesas-reconciliation.yml` consulta cambios cada **6 horas** (horario UTC, con posibles retrasos de GitHub). Para generar PRs, el repositorio debe permitir a Actions crear solicitudes de extracción. La publicación exige revisión humana explícita y contraste de teléfonos, proveedores de remesas e independencia del negocio. El cron de GitHub no sustituye un servicio de monitorización de disponibilidad garantizada.

## Datos revisados en la ejecución inicial

El paquete de entrega incluye CSV y SQLite en `output/`, más un informe JSON. Los registros de FinCEN y listas de licencia están marcados como candidatos o entidades regulatorias; no son agentes verificados. **No sustituyas `data/locations.json` con el CSV de candidatos.**