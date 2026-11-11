# ST Remesas — Centro privado de verificación V1

**Objetivo:** panel de administración independiente de `st-remesas.vercel.app`; consultas por solicitud explícita, comparación contra el catálogo real de 27 fragmentos, importación CSV local limitada a 500 filas por archivo y exportación de cola de revisión. No publica fichas.

## Seguridad

- Proyecto Vercel `st-remesas-admin` creado con `ssoProtection: {deploymentType: "all"}`. Solo miembros autorizados del equipo pueden entrar. No activar excepciones públicas ni usar el panel desde el sitio principal.
- Las claves de APIs son exclusivas de la **configuración del proyecto privado** en **Settings → Environment Variables**; no ponerlas en HTML, GitHub ni mensajes de chat. Configurar al menos en `production`, también `preview` si hace falta.
- API de solo lectura, `Content-Type: application/json`, mismo origen, sin CORS, sin logs personales ni almacenamiento. Resultados API de fuentes externas solo se muestran de manera efímera y sujetos a sus licencias.
- La validación de Twilio indica **tipo/operador de la línea, NO titularidad del teléfono ni servicio de remesas**. No hacer llamadas automáticas.
- Los datos de Google Places pueden tener limitaciones de almacenamiento/redistribución: no exportarlos masivamente sin comprobar la licencia.

## Variables opcionales

| Fuente | Variables en Vercel | Endpoint |
|---|---|---|
| Google Places (New) | `GOOGLE_PLACES_API_KEY` | `POST https://places.googleapis.com/v1/places:searchText` |
| Foursquare Places | `FOURSQUARE_API_KEY` | `GET https://places-api.foursquare.com/places/search` |
| Yelp Fusion | `YELP_API_KEY` | `GET https://api.yelp.com/v3/businesses/search` |
| OpenCorporates | `OPENCORPORATES_API_TOKEN` | `GET https://api.opencorporates.com/v0.4/companies/search` |
| Twilio Lookup | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | `GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}` |

No se fabrican claves. Cada proveedor muestra «Requiere clave» cuando no se ha autorizado. En particular, el uso de campos de Google Places puede generar cargos variables; se escogen campos mínimos sin teléfonos.

## Comparación y calidad

El botón **Cruzar con ST Remesas** descarga en memoria los 27 fragmentos de la web pública y verifica su JSON, IDs y SHA-256 antes de comparar por nombre, domicilio, ciudad y estado. Este primer filtro es conservador: mismo teléfono **no** basta para fusionar dos negocios. Devuelve `PRESENTE_EN_CATALOGO`, `POSIBLE_DUPLICADO_REVISAR` o `SIN_COINCIDENCIA_DETECTADA`. No certifica ninguno como nuevo agente.

Los archivos CSV seleccionados permanecen en memoria del navegador. En este módulo no hay base persistente ni publicación; los flujos programados de GitHub y la revisión humana se encargan de la fase posterior. No se afirma que el sistema se actualice automáticamente desde Drive sin tener acceso autorizado.

## Pruebas

`npm test` ejecuta pruebas de normalización, E.164, seguridad, validación y API. `node --check admin.js` y `node --check api/connectors.js` verifican sintaxis.

**Despliegue:** proyecto privado `st-remesas-admin` (no sustituye el proyecto público `st-remesas`). Se recomienda mantener Vercel Authentication con **All Deployments** y comprobar que el dominio privado devuelve un inicio de sesión cuando se accede sin permisos.