import json
from pathlib import Path

import duckdb

DB = Path(r"j:\Mi unidad\RECETAS\BASE_DATOS_RECETAS\recetas.duckdb")
OUT_DIR = Path(r"j:\Mi unidad\RECETAS\00_ACTUAL\recetas_pacientes")


def rows_block(columns, rows):
    return {"cols": list(columns), "rows": [list(row) for row in rows]}


def fetch_block(con, query):
    cur = con.execute(query)
    return rows_block([item[0] for item in cur.description], cur.fetchall())


con = duckdb.connect(str(DB), read_only=True)

max_fecha = con.execute("SELECT MAX(fecha) FROM fact_recetas").fetchone()[0]
min_fecha = con.execute("SELECT MIN(fecha) FROM fact_recetas").fetchone()[0]
if max_fecha is None:
    raise SystemExit("No hay datos en fact_recetas")

base_cte = """
WITH dedup AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY nrecetasap, pos, fuente ORDER BY id) AS rn
    FROM fact_recetas
    WHERE nrecetasap IS NOT NULL
), base AS (
    SELECT
        c.fecha::DATE AS fecha,
        strftime(c.fecha, '%Y-%m') AS mes,
        c.nrecetasap AS receta_id,
        p.cedula AS paciente_id,
        COALESCE(NULLIF(TRIM(p.nombre), ''), 'Paciente sin nombre') AS paciente_nombre,
        m.codigo AS medico_id,
        COALESCE(NULLIF(TRIM(m.nombre), ''), 'Medico sin nombre') AS medico_nombre,
        med.codigo_sap AS producto_codigo,
        COALESCE(NULLIF(med.texto_breve, ''), med.texto_std, 'Producto sin descripcion') AS producto,
        COALESCE(c.cantidad_recetada, 0) AS cantidad_recetada,
        COALESCE(c.cantidad_dispensada, 0) AS cantidad_dispensada,
        COALESCE(a.descripcion, 'Sin ventanilla') AS ventanilla
    FROM dedup c
    LEFT JOIN dim_paciente p ON p.id = c.id_paciente
    LEFT JOIN dim_medico m ON m.id = c.id_medico
    LEFT JOIN dim_medicamento med ON med.id = c.id_medicamento
    LEFT JOIN dim_almacen a ON a.id = c.id_farmacia
    WHERE c.rn = 1
      AND (p.cedula IS NOT NULL OR m.codigo IS NOT NULL)
)
"""

overview_kpis = con.execute(
    base_cte
    + """
SELECT
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT paciente_id) AS total_pacientes,
    COUNT(DISTINCT medico_id) AS total_medicos,
    COUNT(DISTINCT producto_codigo) AS total_productos,
    SUM(cantidad_recetada) AS total_recetado,
    SUM(cantidad_dispensada) AS total_dispensado
FROM base
"""
).fetchone()

overview = {
    "metadata": {
        "fecha_desde": str(min_fecha),
        "fecha_corte": str(max_fecha),
        "generado": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    },
    "kpis": {
        "total_recetas": int(overview_kpis[0] or 0),
        "total_pacientes": int(overview_kpis[1] or 0),
        "total_medicos": int(overview_kpis[2] or 0),
        "total_productos": int(overview_kpis[3] or 0),
        "total_recetado": float(overview_kpis[4] or 0),
        "total_dispensado": float(overview_kpis[5] or 0),
    },
    "top_pacientes": fetch_block(
        con,
        base_cte
        + """
SELECT
    paciente_id,
    paciente_nombre,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT mes) AS meses,
    COUNT(DISTINCT producto_codigo) AS productos,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada,
    MAX(fecha)::VARCHAR AS ultima_fecha
FROM base
WHERE paciente_id IS NOT NULL
GROUP BY 1,2
ORDER BY total_recetas DESC, cantidad_recetada DESC, paciente_nombre
LIMIT 20
"""
    ),
    "top_medicos": fetch_block(
        con,
        base_cte
        + """
SELECT
    medico_id,
    medico_nombre,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT mes) AS meses,
    COUNT(DISTINCT paciente_id) AS pacientes,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada,
    MAX(fecha)::VARCHAR AS ultima_fecha
FROM base
WHERE medico_id IS NOT NULL
GROUP BY 1,2
ORDER BY total_recetas DESC, cantidad_recetada DESC, medico_nombre
LIMIT 20
"""
    ),
    "detail": fetch_block(
        con,
        base_cte
        + """
SELECT
    fecha::VARCHAR AS fecha,
    receta_id,
    paciente_id,
    paciente_nombre,
    medico_id,
    medico_nombre,
    producto_codigo,
    producto,
    cantidad_recetada,
    cantidad_dispensada,
    ventanilla
FROM base
ORDER BY fecha DESC, receta_id DESC
LIMIT 200
"""
    ),
}

patients_data = {
    "metadata": overview["metadata"],
    "summary": fetch_block(
        con,
        base_cte
        + """
SELECT
    paciente_id,
    paciente_nombre,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT mes) AS meses,
    COUNT(DISTINCT producto_codigo) AS productos,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada,
    MAX(fecha)::VARCHAR AS ultima_fecha
FROM base
WHERE paciente_id IS NOT NULL
GROUP BY 1,2
ORDER BY total_recetas DESC, cantidad_recetada DESC, paciente_nombre
"""
    ),
    "monthly": fetch_block(
        con,
        base_cte
        + """
SELECT
    paciente_id,
    mes,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT producto_codigo) AS productos,
    COUNT(DISTINCT medico_id) AS medicos,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada
FROM base
WHERE paciente_id IS NOT NULL
GROUP BY 1,2
ORDER BY paciente_id, mes
"""
    ),
}

doctors_data = {
    "metadata": overview["metadata"],
    "summary": fetch_block(
        con,
        base_cte
        + """
SELECT
    medico_id,
    medico_nombre,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT mes) AS meses,
    COUNT(DISTINCT paciente_id) AS pacientes,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada,
    MAX(fecha)::VARCHAR AS ultima_fecha
FROM base
WHERE medico_id IS NOT NULL
GROUP BY 1,2
ORDER BY total_recetas DESC, cantidad_recetada DESC, medico_nombre
"""
    ),
    "monthly": fetch_block(
        con,
        base_cte
        + """
SELECT
    medico_id,
    mes,
    COUNT(DISTINCT receta_id) AS total_recetas,
    COUNT(DISTINCT paciente_id) AS pacientes,
    COUNT(DISTINCT producto_codigo) AS productos,
    SUM(cantidad_recetada) AS cantidad_recetada,
    SUM(cantidad_dispensada) AS cantidad_dispensada
FROM base
WHERE medico_id IS NOT NULL
GROUP BY 1,2
ORDER BY medico_id, mes
"""
    ),
}

(OUT_DIR / "data.json").write_text(
    json.dumps(overview, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)
(OUT_DIR / "pacientes_data.json").write_text(
    json.dumps(patients_data, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)
(OUT_DIR / "medicos_data.json").write_text(
    json.dumps(doctors_data, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)

con.close()

print("Generados:")
print("-", OUT_DIR / "data.json")
print("-", OUT_DIR / "pacientes_data.json")
print("-", OUT_DIR / "medicos_data.json")
