# ST Remesas · Centro de conectores externos V3

Destino de referencia: https://st-remesas.vercel.app/ (proyecto Vercel `st-remesas`).

## Funciones disponibles

- En cada ficha: búsqueda manual por nombre y domicilio en Google Maps, OpenStreetMap, Bing, Manta, Bizapedia (buscador externo), OpenCorporates, Yelp, y Small Business Database (buscador externo).
- Selección de navegador Android: abrir búsquedas en Chrome u Opera mediante intents estándar y fallback HTTPS; en escritorio, nueva pestaña. La disponibilidad depende del dispositivo.
- Teléfono: copiar, `tel:` del sistema, y enlace de Talkatone a su ficha oficial de Google Play. Talkatone **no** es conector API ni recibe llamadas automáticas desde el buscador.
- CRM Bizzi (https://getbizzi.app/): abrir su página. Ninguna conexión de API, alta de cliente, ni exportación automática.
- Busafill: solo marcador **pendiente de URL oficial y contrato de acceso**. El nombre no pudo asociarse de forma fiable a un proveedor y no hay endpoint inventado.
- No hay scraping automático, envío de contactos, ni verificación ficticia de teléfonos. Las búsquedas externas se abren únicamente al pulsar.

## Integración

Script único `site/st-remesas-connectors.js`, sin dependencias y compatible con las tarjetas existentes `#results .business-card` de la versión publicada (9,236 fichas observadas). Monta controles en las 12 tarjetas visibles de cada página mediante `MutationObserver` sin leer, alterar, ni duplicar las fuentes originales. Se puede insertar al final de `index.html` como script local o script estático:

`<script src="/st-remesas-connectors.js" defer></script>`

La ruta es ilustrativa: el script debe estar servido por el despliegue que lo use. **No hay publicación de producción como resultado de preparar este módulo.**

La demostración Vercel (preview) reutiliza en modo solo lectura los segmentos de producción por una reescritura HTTPS temporal. Esta reescritura es únicamente para preview; al publicar en producción se deben incluir los 27 segmentos reales como archivos versionados para evitar un proxy recursivo.

## QA

`node --test tests/test-connectors.cjs`

La verificación del directorio publicada sigue separada de la de teléfonos y remesadoras. No inferir independencia, titularidad ni operación de un negocio por coincidencias en búsquedas.