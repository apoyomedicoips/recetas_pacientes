# recetas_pacientes

Base inicial para un tablero de analisis de recetas orientado a dos ejes:

- paciente
- medico prescriptor

## Objetivo

Reusar la experiencia del proyecto `informe_insumos`, pero cambiando el universo analitico desde stock por producto hacia comportamiento de recetas por persona y por prescriptor.

## Alcance propuesto

- KPIs de recetas, pacientes, medicos y productos
- filtros por periodo, paciente, medico, servicio y ventanilla
- vista historica por paciente
- ranking por medico
- detalle exportable

## Archivos iniciales

- `index.html`: landing del nuevo tablero
- `dashboard.css`: estilo base
- `dashboard.js`: carga de `data.json` y estado inicial
- `data.json`: placeholder vacio para la primera exportacion real

## Siguiente paso recomendado

Construir un `export_data.py` especifico para:

- `receta_id`
- `paciente_id` o identificador anonimizado
- `paciente_nombre` si el alcance lo permite
- `medico_id`
- `medico_nombre`
- `servicio`
- `especialidad`
- `producto_codigo`
- `producto`
- `cantidad_recetada`
- `cantidad_dispensada`
- `fecha`
- `ventanilla`
