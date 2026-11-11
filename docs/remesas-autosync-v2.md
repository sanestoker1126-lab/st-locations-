# ST Locations — conciliación continua V2 · 10 nov 2026

## Resultado del cruce histórico

Se compararon 89,901 identidades candidatas del inventario local con **4,499 fichas del buscador web offline** (fecha de observación declarada 2026-09-16). Se obtuvo:

- Coincidencia exacta nombre + ubicación: **4,479 candidatos**.
- Mismo domicilio, nombre diferente: **1,592 candidatos** a revisión, sin fusión.
- Mismo teléfono, nombre/domicilio distinto: **480 candidatos** a revisión, sin fusión.
- Ninguna coincidencia detectada bajo esas reglas: **83,350 candidatos**, no necesariamente negocios nuevos.
- Relaciones en CSV (puede haber varias por candidato): **6,579**.

**No significa que los números estén vigentes ni que cada establecimiento transmita remesas actualmente.**

## Hallazgos adicionales de Drive

Se auditaron cinco hojas de Drive generadas históricamente por Kimi AI: **393 filas**, **131 identidades por nombre+dirección+ciudad**, y **262 filas redundantes** entre versiones. No hubo coincidencias exactas de esos tres campos en el inventario consolidado, pero **la falta de estado en varias hojas y la falta de validación externa impiden declarar altas nuevas**. Se entregan por separado para revisión; no se agregan al maestro de candidatos publicado.

## Correcciones del programador

1. `tools/remesas_reconcile_ci.py`: bloquea conciliación vacía, genera estado `BLOCKED_NO_INPUTS` cuando no hay snapshots, publica métricas no sensibles, y cruza candidatos contra el catálogo real cuando están los JSON del checkout.
2. `tools/remesas_repo_crosswalk.py`: identifica coincidencias exactas y ambigüedades con un catálogo JSON o HTML offline; **no modifica datos públicos**.
3. `.github/workflows/remesas-reconciliation.yml`: ejecuta realmente los tests `test_remesas_*.py`, no agrega CSV externos ni datos personales a PRs y omite PR cuando faltan fuentes.
4. `tests/test_remesas_repo_crosswalk.py` y `tests/test_remesas_ci_status.py`: cobertura de cruces y bloqueo con fuentes ausentes.

## Cobertura y límites

El catálogo comercial GitHub contiene 417,496 registros de negocios de varios países y giros; **no equivalen a agentes de remesas**. El paquete de 89,901 candidatos se construyó con 13 fuentes/hojas y 166,377 observaciones; el cruce local descrito se efectuó con una copia histórica del buscador, no una descarga en tiempo real de todos los JSON actuales de GitHub. El nuevo script CI puede cruzar el checkout completo cuando los snapshots estén disponibles al runner.

**Pendiente para automatización real:** compartir la hoja maestra con una cuenta de servicio de Google con permiso de solo lectura y configurar `ST_LOCATIONS_GOOGLE_SERVICE_ACCOUNT_JSON` en GitHub Actions, habilitar PRs por Actions, y proveer feeds de Biblioteca por un puente autorizado o carga privada. La Biblioteca de ChatGPT no se sincroniza por sí sola al runner.

## Validación local

Se ejecutaron **7 pruebas unitarias**, todas correctas. Se verificó integridad `PRAGMA integrity_check = ok` en `st_locations_staging.sqlite`, con 89,901 ubicaciones y 166,377 observaciones. No se publicaron fichas automáticamente.