# ST Locations | Remesas USA: ingesta auditada 2026-11-06

Estado: lote separado para revisión. NO forma parte de los 417,496 registros publicados.

Se revisaron 11004 filas recibidas frente a 8437 ubicaciones estadounidenses del manifiesto 1a7a3091335aaefd56665aff33f0548d5dcbd47fd1356ece36948a3beb48ec5a.

Duplicados por ID de origen: 5326. Duplicados por nombre y ubicación: 103.
Posibles duplicados en revisión humana: 608. Repetidos internos adicionales: 3.
Sin coincidencia detectada: 4,964. Candidatos con datos mínimos y operador identificado: 3,532.
Fichas incompletas o excluidas: 1,432.

ARCHIVOS:
para_validar-000.jsonl a para_validar-007.jsonl: candidatos; todas las entradas mantienen phone_current_verified=false y agent_current_verified=false.
incompletos_o_excluidos-000.jsonl a incompletos_o_excluidos-002.jsonl: casos preservados, sin contabilizar como candidatos aptos.
posibles_duplicados-000.jsonl y posibles_duplicados-001.jsonl: colisiones que no deben fusionarse automáticamente.
clasificacion_indices.json: índices 0-based para auditar cada fila de entrada.
auditoria.json: métricas, exclusiones y versión de catálogo comparada.

REGLAS:
1. Teléfono compartido no equivale a un mismo negocio; no eliminar sucursales legítimas.
2. La publicación histórica, el formato E.164 y una página de proveedor no certifican que el teléfono o la agencia estén activos.
3. Revalidar comercio, independencia, mercado atendido, remesadora y contacto antes de considerar la incorporación pública.
4. Conciliar nombres alternativos, resolver conflictos y conservar origen y fecha de cada fuente.
5. Regenerar conjuntamente SQLite/base de trabajo, JSON público, particiones, manifiesto y descargas CSV/ZIP.
6. Probar conteos, búsqueda, exportaciones, filtros y paginación antes de desplegar.

El sitio web y la base pública permanecen intactos; no se realizaron llamadas telefónicas.
