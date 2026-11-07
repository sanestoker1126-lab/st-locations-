# Minimap y geocodificación de Punto Envíos

La página `buscador.html` consulta los 4,499 registros existentes de `data/locations.json`. **Ninguno tiene latitud/longitud original.** Por ello este módulo NO dibuja pines inventados.

## Comportamiento
- El minimapa de OpenStreetMap muestra solo puntos de `data/remesas-geopoints.json` validados o coincidencias consultadas individualmente por el visitante.
- El botón **Ubicar en minimapa** consulta Nominatim **solo tras una acción explícita**, nunca en lote ni con autocompletado; comprueba número de calle y ZIP. Si no coinciden, no crea un marcador.
- Las coordenadas consultadas en la sesión se etiquetan como **estimadas/no verificadas**, no se escriben en el repositorio ni acreditan actividad del negocio.
- El control **Mi ubicación** solicita permiso al navegador y no almacena la posición.
- El mapa se puede expandir y contraer; al cambiar filtros, se actualizan los marcadores visibles y la agrupación cambia con el zoom.

## Para añadir coordenadas validadas
Añadir a `data/remesas-geopoints.json` objetos `{"id":"US-...","lat":0.0,"lng":0.0,"precision":"address","source":"URL o referencia documental","verified_at":"YYYY-MM-DD"}` solo después de verificación real de dirección y ubicación. La versión inicial tiene `points: []` por seguridad. Validar ID frente a `data/locations.json`, coordenadas, fuente y fecha en una tarea de publicación posterior.

## Dependencias y políticas
Leaflet 1.9.4 (CDN con integridad SRI), mosaicos de OpenStreetMap con atribución visible y solicitudes puntuales a Nominatim. El servicio público Nominatim no es adecuado para geocodificación masiva ni para un producto comercial de alto tráfico; en producción, sustituir por geocodificador contratado o propio, con cuotas, caché, revisión y procedencia. Los mapas cargan mosaicos externos y Nominatim solo recibe la dirección cuando se pulsa expresamente localizar. Revisar las políticas OSMF y los permisos de navegador.

El conjunto de datos de candidatos `data/intake/remesas_usa_2026-11-06` permanece separado; no se incluye automáticamente en la publicación.
