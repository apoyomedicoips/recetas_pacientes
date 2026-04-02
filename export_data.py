import json
from datetime import datetime, timedelta
from pathlib import Path

import duckdb

DB = Path(r'j:\Mi unidad\RECETAS\BASE_DATOS_RECETAS\recetas.duckdb')
OUT = Path(r'j:\Mi unidad\RECETAS\00_ACTUAL\recetas_pacientes\data.json')

con = duckdb.connect(str(DB), read_only=True)
max_fecha = con.execute("SELECT MAX(fecha) FROM fact_recetas").fetchone()[0]
if max_fecha is None:
    raise SystemExit("No hay datos en fact_recetas")
fecha_desde = max_fecha - timedelta(days=90)

base_cte = '''
WITH dedup AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY nrecetasap, pos, fuente ORDER BY id) AS rn
    FROM fact_recetas
    WHERE nrecetasap IS NOT NULL
), clean AS (
    SELECT *
    FROM dedup
    WHERE rn = 1
      AND fecha BETWEEN ? AND ?
), base AS (
    SELECT
        c.fecha::VARCHAR AS fecha,
        c.nrecetasap AS receta_id,
        p.cedula AS paciente_id,
        COALESCE(NULLIF(TRIM(p.nombre), ''), 'Paciente sin nombre') AS paciente_nombre,
        m.codigo AS medico_id,
        COALESCE(NULLIF(TRIM(m.nombre), ''), 'Medico sin nombre') AS medico_nombre,
        med.codigo_sap AS producto_codigo,
        COALESCE(NULLIF(med.texto_breve, ''), med.texto_std, 'Producto sin descripcion') AS producto,
        COALESCE(c.cantidad_recetada, 0) AS cantidad_recetada,
        COALESCE(c.cantidad_dispensada, 0) AS cantidad_dispensada,
        COALESCE(a.descripcion, 'Sin ventanilla') AS ventanilla,
        COALESCE(c.cronico, FALSE) AS cronico,
        COALESCE(c.receta_impresa, FALSE) AS receta_impresa
    FROM clean c
    LEFT JOIN dim_paciente p ON p.id = c.id_paciente
    LEFT JOIN dim_medico m ON m.id = c.id_medico
    LEFT JOIN dim_medicamento med ON med.id = c.id_medicamento
    LEFT JOIN dim_almacen a ON a.id = c.id_farmacia
    WHERE p.cedula IS NOT NULL OR m.codigo IS NOT NULL
)
'''

kpi_query = base_cte + '''
SELECT
    COUNT(*) AS total_registros,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT paciente_id) AS total_pacientes,
    COUNT(DISTINCT medico_id) AS total_medicos,
    COUNT(DISTINCT producto_codigo) AS total_productos,
    SUM(cantidad_recetada) AS total_recetado,
    SUM(cantidad_dispensada) AS total_dispensado
FROM base
'''
kpis = con.execute(kpi_query, [fecha_desde, max_fecha]).fetchone()

pacientes_query = base_cte + '''
SELECT
    paciente_id,
    paciente_nombre,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(*) AS productos,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada
FROM base
WHERE paciente_id IS NOT NULL
GROUP BY 1,2
ORDER BY total_recetas DESC, cantidad_recetada DESC, paciente_nombre
LIMIT 20
'''
medicos_query = base_cte + '''
SELECT
    medico_id,
    medico_nombre,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(*) AS productos,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada
FROM base
WHERE medico_id IS NOT NULL
GROUP BY 1,2
ORDER BY total_recetas DESC, cantidad_recetada DESC, medico_nombre
LIMIT 20
'''
detail_query = base_cte + '''
SELECT *
FROM base
ORDER BY fecha DESC, receta_id DESC, producto_codigo
LIMIT 200
'''

pacientes_cols = ["paciente_id","paciente_nombre","total_recetas","productos","cantidad_recetada","cantidad_dispensada"]
medicos_cols = ["medico_id","medico_nombre","total_recetas","productos","cantidad_recetada","cantidad_dispensada"]
detail_cols = [
    "fecha","receta_id","paciente_id","paciente_nombre","medico_id","medico_nombre",
    "producto_codigo","producto","cantidad_recetada","cantidad_dispensada","ventanilla","cronico","receta_impresa"
]

def rows_to_dicts(query, cols):
    return [dict(zip(cols, row)) for row in con.execute(query, [fecha_desde, max_fecha]).fetchall()]

payload = {
    "metadata": {
        "project": "recetas_pacientes",
        "fecha_desde": str(fecha_desde),
        "fecha_corte": str(max_fecha),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total_registros": int(kpis[0] or 0),
        "total_recetas": int(kpis[1] or 0),
        "total_pacientes": int(kpis[2] or 0),
        "total_medicos": int(kpis[3] or 0),
        "total_productos": int(kpis[4] or 0),
        "total_recetado": int(kpis[5] or 0),
        "total_dispensado": int(kpis[6] or 0)
    },
    "top_pacientes": rows_to_dicts(pacientes_query, pacientes_cols),
    "top_medicos": rows_to_dicts(medicos_query, medicos_cols),
    "detail": rows_to_dicts(detail_query, detail_cols)
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"Escrito {OUT} con snapshot ejecutivo")
