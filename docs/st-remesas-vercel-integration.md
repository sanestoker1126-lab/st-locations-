# ST Remesas — integración con Vercel (destino real)

## Destino verificado

- **Aplicación pública:** https://st-remesas.vercel.app/
- **Equipo Vercel:** `team_DAQi7HOE0NXs0A1o0y4gmiXd`
- **Proyecto:** `st-remesas` (`prj_6oKmNWNrV1VIlZHVYbNaBroJGTiH`)
- **Último despliegue observado:** `dpl_FinLR61QbB5fnU371SSTwChCdscD` (production, READY).
- **Catálogo visible al inspeccionarlo:** 9,236 fichas, **sin** prueba individual de teléfono, licencia o remesas vigentes.
- **Origen actualmente servido:** `src/index.html` y 27 segmentos `src/data/000.txt` … `026.txt`. El navegador descarga `/data/{000..026}.txt` y ejecuta `JSON.parse(parts.join(''))`.
- **Vínculo Git en Vercel:** no detectado. Los commits de `sanestoker1126-lab/st-locations-` no publican este Vercel.

## Qué cambia en la reconciliación

`tools/remesas_vercel_reference.py` descarga los 27 segmentos **del sitio público exacto**, verifica que el JSON contenga `records` e IDs de ficha no duplicados, y crea un *snapshot temporal privado* para comparación. Los archivos temporales no entran a Git ni a los artefactos de GitHub Actions.

El reconciliador usa el snapshot de ST Remesas para su `published_overlap`; la referencia antigua de GitHub Pages se conserva como contexto, **no como baseline de producción**. Si Vercel no responde, no hay datos de origen o el JSON está incompleto, se bloquea el informe concluyente y cualquier propuesta automática.

El catálogo comercial de 417,496 entradas y el resultado de 89,901 candidatos no equivalen a fichas de agentes vigentes y **no deben sustituir** las 9,236 fichas visibles del sitio. Mantener la trazabilidad de cada dato y documentar conflictos de teléfono, alias y domicilio.

## Qué falta para publicar actualizaciones reales

1. Trasladar y versionar el HTML y las 27 piezas JSON de la **misma** versión actual de ST Remesas a un repositorio fuente del proyecto; nunca reemplazarlas silenciosamente por `data/locations.json` de GitHub Pages, que contiene otro universo.
2. Construir un exportador de fichas **aprobadas** que regenere todo el JSON y lo divida en partes, manteniendo IDs, metadatos, índices, enlaces y búsquedas del HTML. No publicar datos de candidatos pendientes ni considerar verificadas las llamadas no realizadas.
3. Crear un despliegue de previsualización en Vercel del proyecto correcto, medir conteos y probar buscador, filtros, exportaciones y minimapa en móviles/PC.
4. Habilitar el despliegue a producción solo tras pruebas, autorización de revisión y respaldo de la versión desplegada. No activar auto-publicación en el pipeline de conciliación.

La base externa de Drive/Biblioteca continúa requiriendo un puente autorizado y credenciales de lectura mínima para ejecuciones no interactivas.