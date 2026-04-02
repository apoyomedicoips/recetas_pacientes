"use strict";

const $ = (id) => document.getElementById(id);
const fmtInt = (value) => Number(value || 0).toLocaleString("es-PY");

function uniqueCount(rows, key) {
  return new Set(
    rows
      .map((row) => row[key])
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
  ).size;
}

function renderEmptyState(message) {
  $("mode-badge").textContent = "Snapshot inicial";
  $("status-box").textContent = message;
}

function renderDashboard(data) {
  const rows = Array.isArray(data.detail) ? data.detail : [];
  const metadata = data.metadata || {};

  $("mode-badge").textContent = rows.length ? "Snapshot cargado" : "Snapshot vacio";
  $("meta-fecha").textContent = metadata.fecha_corte || "Sin corte";
  $("kpi-recetas").textContent = fmtInt(uniqueCount(rows, "receta_id"));
  $("kpi-pacientes").textContent = fmtInt(uniqueCount(rows, "paciente_id"));
  $("kpi-medicos").textContent = fmtInt(uniqueCount(rows, "medico_id"));
  $("kpi-productos").textContent = fmtInt(uniqueCount(rows, "producto_codigo"));

  const statusBox = $("status-box");
  if (!rows.length) {
    statusBox.textContent =
      "La estructura base ya esta publicada. El siguiente paso es generar un data.json para pacientes y medicos desde DuckDB o desde la fuente operativa que definamos.";
    return;
  }

  statusBox.classList.add("ready");
  statusBox.textContent =
    "Se detectaron datos reales en data.json. Ya podemos avanzar con filtros activos, ranking por medico, ranking por paciente y detalle temporal.";
}

async function init() {
  try {
    const response = await fetch(`data.json?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderDashboard(data);
  } catch (error) {
    renderEmptyState(
      "No se encontro un data.json operativo todavia. La interfaz quedo lista para conectar la primera exportacion del proyecto recetas_pacientes."
    );
    console.error(error);
  }
}

init();
