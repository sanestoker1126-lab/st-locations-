# ST Locations — conciliación adicional hacia 50,000 registros (2026-11-09)

**Rama de QA. No publicar datos ni fusionar automáticamente este cambio.**

## Universo y comparabilidad
El PR [#2](https://github.com/sanestoker1126-lab/st-locations-/pull/2) comparó 11,004 filas recibidas con 8,437 fichas de EE. UU. en una base global pública de 417,496 registros. Apartó 3,532 candidatos nuevos no certificados y 608 posibles duplicados. **Estos universos no se suman con los 10,947 registros del consolidado local**, porque pueden solaparse.

Esta segunda auditoría utilizó el consolidado de Biblioteca de 2026-11-06 (10,947 filas, 10,947 IDs únicos) más la base histórica de 2026-11-04 (10,987 filas), un suplemento de 29 fichas y otro de 26.

## Resultado reproducido sobre el consolidado local
- 9,334 candidatos históricos no certificados; 2 fichas con respaldo web sin llamada.
- 1,171 requieren un teléfono válido, 14 requieren operador identificado.
- 357 en cuarentena por conflictos; 69 cadenas excluidas.
- 110 grupos y 222 registros comparten teléfono+dirección: **posibles alias/colisiones**, no bajas automáticas.
- De los 67 IDs históricos ausentes como IDs actuales, los 67 tienen al menos una correspondencia potencial en el consolidado. Se documenta el mapeo provisional, sin declarar fusión certificada.
- 55 filas de suplementos: 38 coincidencias por nombre+dirección+ciudad+estado y 17 por teléfono+ciudad+estado pendientes de confirmar alias/dirección. Ninguna queda sin coincidencia potencial. Hay 26 repeticiones entre suplementos.
- 0 nuevos registros certificados para publicación en esta auditoría; ninguna llamada de verificación se realizó.

## Archivos
- `auditoria_50000.json`: conteos y restricciones.
- `ids_historicos_para_revision.csv`: 67 referencias históricas y posibles IDs conservados.
- `cruce_suplementos_55.csv`: correspondencias de los dos suplementos y sus reglas.
- `colisiones_telefono_direccion_222.csv`: 222 filas a revisión humana, sin eliminar sucursales legítimas.

El paquete local de auditoría incluye el CSV staging de 10,947 fichas y las exportaciones de cada estado. El CSV staging **no reemplaza** `data/master-contacts.json`.

## Política de publicación
1. Excluir cadenas comerciales y los registros sin servicio de remesas comprobable.
2. Conservar el ID existente y todas las fuentes; normalizar nombre, dirección y teléfonos sin sobrescribir el original.
3. Fusión automática **solo** con identidad inequívoca y teléfono no contradictorio; mismo teléfono sin misma ubicación no basta.
4. Cualquier discrepancia de nombre, domicilio, sucursal o teléfono va a cuarentena.
5. Publicable solo tras verificar de manera actual la actividad, el teléfono, la remesadora y que el negocio pertenece al universo objetivo; guardar fecha+URL o evidencia válida. Formato E.164 no implica verificación.
6. Antes de cambiar la publicación hay que cruzar contra el **snapshot actual de las 8,437 fichas de EE. UU.**, resolver revisión humana, regenerar catálogo/shards/manifiesto/descargas con pruebas de conteos.
7. No se deben confundir 417,496 registros globales con la meta estadounidense de 50,000 comercios independientes verificables.

**Objetivo:** 50,000 ubicaciones de comercios independientes de EE. UU. que prestan remesas. Frente a la referencia histórica de 8,437 fichas estadounidenses, la distancia nominal es 41,563; este número no constituye un déficit de *verificados* porque no se ha certificado el universo actual.
