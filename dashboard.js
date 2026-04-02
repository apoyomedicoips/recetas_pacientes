"use strict";

const $ = (id) => document.getElementById(id);
const fmtInt = (value) => Number(value || 0).toLocaleString("es-PY");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]);

const state = {
  raw: null,
  filters: {
    paciente: "",
    medico: "",
    producto: "",
    ventanilla: "",
  },
  focus: {
    type: "",
    id: "",
  },
};

function textIncludes(value, query) {
  return String(value ?? "").toLowerCase().includes(String(query ?? "").toLowerCase());
}

function applyFilters(rows) {
  return rows.filter((row) => {
    if (state.filters.paciente) {
      const matchPaciente = textIncludes(row.paciente_nombre, state.filters.paciente) || textIncludes(row.paciente_id, state.filters.paciente);
      if (!matchPaciente) return false;
    }
    if (state.filters.medico) {
      const matchMedico = textIncludes(row.medico_nombre, state.filters.medico) || textIncludes(row.medico_id, state.filters.medico);
      if (!matchMedico) return false;
    }
    if (state.filters.producto) {
      const matchProducto = textIncludes(row.producto, state.filters.producto) || textIncludes(row.producto_codigo, state.filters.producto);
      if (!matchProducto) return false;
    }
    if (state.filters.ventanilla && row.ventanilla !== state.filters.ventanilla) return false;
    return true;
  });
}

function buildTop(rows, keyId, keyName) {
  const map = new Map();
  rows.forEach((row) => {
    const id = row[keyId];
    if (id == null || id === "") return;
    const current = map.get(id) || {
      id,
      name: row[keyName] || "Sin nombre",
      recetasSet: new Set(),
      productos: 0,
      cantidad_recetada: 0,
      cantidad_dispensada: 0,
    };
    current.recetasSet.add(row.receta_id);
    current.productos += 1;
    current.cantidad_recetada += Number(row.cantidad_recetada || 0);
    current.cantidad_dispensada += Number(row.cantidad_dispensada || 0);
    map.set(id, current);
  });
  return [...map.values()]
    .map((item) => ({
      id: item.id,
      name: item.name,
      total_recetas: item.recetasSet.size,
      productos: item.productos,
      cantidad_recetada: item.cantidad_recetada,
      cantidad_dispensada: item.cantidad_dispensada,
    }))
    .sort((a, b) => b.total_recetas - a.total_recetas || b.cantidad_recetada - a.cantidad_recetada || String(a.name).localeCompare(String(b.name), "es"))
    .slice(0, 10);
}

function renderRanking(targetId, items, emptyMessage, type) {
  const container = $(targetId);
  if (!items || !items.length) {
    container.innerHTML = `<p class="empty-note">${esc(emptyMessage)}</p>`;
    return;
  }
  container.innerHTML = `<div class="ranking-list">${items.map((item, index) => `
    <article class="ranking-item clickable ${state.focus.type === type && String(state.focus.id) === String(item.id) ? "active" : ""}" data-focus-type="${type}" data-focus-id="${esc(item.id)}">
      <span class="rank-badge">${index + 1}</span>
      <div>
        <div class="ranking-name">${esc(item.name)}</div>
        <div class="ranking-sub">${fmtInt(item.total_recetas)} recetas · ${fmtInt(item.productos)} renglones · ${fmtInt(item.cantidad_recetada)} recetado</div>
      </div>
      <div class="ranking-val">${fmtInt(item.cantidad_dispensada)} disp.</div>
    </article>`).join("")}</div>`;
  container.querySelectorAll(".ranking-item.clickable").forEach((item) => {
    item.addEventListener("click", () => {
      const focusType = item.dataset.focusType;
      const focusId = item.dataset.focusId;
      if (state.focus.type === focusType && String(state.focus.id) === String(focusId)) {
        state.focus = { type: "", id: "" };
      } else {
        state.focus = { type: focusType, id: focusId };
      }
      renderAll();
    });
  });
}

function renderDetail(rows) {
  const body = $("detail-body");
  if (!rows || !rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-note">Sin registros disponibles.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${esc(row.fecha)}</td>
      <td>${esc(row.receta_id)}</td>
      <td>${esc(row.paciente_nombre)}</td>
      <td>${esc(row.medico_nombre)}</td>
      <td>${esc(row.producto)}</td>
      <td>${fmtInt(row.cantidad_recetada)}</td>
      <td>${fmtInt(row.cantidad_dispensada)}</td>
      <td>${esc(row.ventanilla)}</td>
    </tr>`).join("");
}

function fillVentanillaFilter(rows) {
  const select = $("filter-ventanilla");
  const current = select.value;
  const options = [...new Set(rows.map((row) => row.ventanilla).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  select.innerHTML = `<option value="">Todas</option>${options.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
  if (current && options.includes(current)) select.value = current;
}

function renderFocusCard(rows) {
  const container = $("focus-card");
  if (!state.focus.type || !state.focus.id) {
    $("focus-meta").textContent = "Selecciona un paciente o médico desde los rankings";
    container.className = "focus-empty";
    container.textContent = "Aún no hay una selección activa.";
    return;
  }

  const isPaciente = state.focus.type === "paciente";
  const focusRows = rows.filter((row) => String(row[isPaciente ? "paciente_id" : "medico_id"]) === String(state.focus.id));
  if (!focusRows.length) {
    $("focus-meta").textContent = "La selección no tiene registros con los filtros actuales";
    container.className = "focus-empty";
    container.textContent = "No hay coincidencias para esta selección dentro del filtro actual.";
    return;
  }

  const recetas = new Set(focusRows.map((row) => row.receta_id)).size;
  const productos = new Set(focusRows.map((row) => row.producto_codigo)).size;
  const cantidadRecetada = focusRows.reduce((acc, row) => acc + Number(row.cantidad_recetada || 0), 0);
  const cantidadDispensada = focusRows.reduce((acc, row) => acc + Number(row.cantidad_dispensada || 0), 0);
  const related = buildTop(
    focusRows,
    isPaciente ? "medico_id" : "paciente_id",
    isPaciente ? "medico_nombre" : "paciente_nombre"
  ).slice(0, 5);
  const topProductos = buildTop(
    focusRows.map((row) => ({
      ...row,
      producto_id_fake: row.producto_codigo,
      producto_name_fake: row.producto,
    })),
    "producto_id_fake",
    "producto_name_fake"
  ).slice(0, 5);

  $("focus-meta").textContent = `${fmtInt(focusRows.length)} renglones dentro del filtro actual`;
  container.className = "focus-card";
  container.innerHTML = `
    <div class="focus-hero">
      <div>
        <span class="focus-type">${isPaciente ? "Paciente" : "Médico"}</span>
        <h3 class="focus-title">${esc(focusRows[0][isPaciente ? "paciente_nombre" : "medico_nombre"])}</h3>
        <div class="focus-subtitle">Identificador: ${esc(state.focus.id)}</div>
      </div>
      <div class="ranking-val">${fmtInt(recetas)} recetas</div>
    </div>
    <div class="focus-metrics">
      <div class="focus-metric"><span class="focus-metric-label">Productos únicos</span><div class="focus-metric-value">${fmtInt(productos)}</div></div>
      <div class="focus-metric"><span class="focus-metric-label">Cantidad recetada</span><div class="focus-metric-value">${fmtInt(cantidadRecetada)}</div></div>
      <div class="focus-metric"><span class="focus-metric-label">Cantidad dispensada</span><div class="focus-metric-value">${fmtInt(cantidadDispensada)}</div></div>
      <div class="focus-metric"><span class="focus-metric-label">Renglones visibles</span><div class="focus-metric-value">${fmtInt(focusRows.length)}</div></div>
    </div>
    <div>
      <strong>${isPaciente ? "Médicos asociados" : "Pacientes asociados"}</strong>
      <ul class="focus-list">
        ${related.map((item) => `<li>${esc(item.name)} · ${fmtInt(item.total_recetas)} recetas</li>`).join("") || "<li>Sin datos asociados</li>"}
      </ul>
    </div>
    <div>
      <strong>Productos destacados</strong>
      <ul class="focus-list">
        ${topProductos.map((item) => `<li>${esc(item.name)} · ${fmtInt(item.total_recetas)} recetas</li>`).join("") || "<li>Sin productos destacados</li>"}
      </ul>
    </div>`;
}

function updateActiveFilterText(filteredRows) {
  const parts = [];
  if (state.filters.paciente) parts.push(`Paciente: ${state.filters.paciente}`);
  if (state.filters.medico) parts.push(`Médico: ${state.filters.medico}`);
  if (state.filters.producto) parts.push(`Producto: ${state.filters.producto}`);
  if (state.filters.ventanilla) parts.push(`Ventanilla: ${state.filters.ventanilla}`);
  $("active-filter").textContent = parts.length
    ? `${parts.join(" · ")} · ${fmtInt(filteredRows.length)} renglones`
    : "Sin filtro activo";
}

function renderAll() {
  const rows = Array.isArray(state.raw?.detail) ? state.raw.detail : [];
  const meta = state.raw?.metadata || {};
  const filteredRows = applyFilters(rows);
  const filteredTopPacientes = buildTop(filteredRows, "paciente_id", "paciente_nombre");
  const filteredTopMedicos = buildTop(filteredRows, "medico_id", "medico_nombre");

  $("mode-badge").textContent = rows.length ? "Snapshot operativo" : "Sin datos";
  $("meta-fecha").textContent = meta.fecha_desde && meta.fecha_corte ? `${meta.fecha_desde} → ${meta.fecha_corte}` : "Sin período";
  $("kpi-recetas").textContent = fmtInt(new Set(filteredRows.map((row) => row.receta_id)).size);
  $("kpi-pacientes").textContent = fmtInt(new Set(filteredRows.map((row) => row.paciente_id).filter((value) => value != null)).size);
  $("kpi-medicos").textContent = fmtInt(new Set(filteredRows.map((row) => row.medico_id).filter((value) => value != null)).size);
  $("kpi-productos").textContent = fmtInt(new Set(filteredRows.map((row) => row.producto_codigo).filter((value) => value != null)).size);
  $("kpi-recetado").textContent = fmtInt(filteredRows.reduce((acc, row) => acc + Number(row.cantidad_recetada || 0), 0));
  $("kpi-dispensado").textContent = fmtInt(filteredRows.reduce((acc, row) => acc + Number(row.cantidad_dispensada || 0), 0));
  $("status-box").textContent = `${fmtInt(meta.total_registros)} renglones analizados · mostrando ${fmtInt(filteredRows.length)} filtrados`;
  $("top-pacientes-meta").textContent = `${fmtInt(filteredTopPacientes.length)} visibles`;
  $("top-medicos-meta").textContent = `${fmtInt(filteredTopMedicos.length)} visibles`;
  updateActiveFilterText(filteredRows);

  renderRanking("top-pacientes", filteredTopPacientes, "Sin pacientes con datos suficientes.", "paciente");
  renderRanking("top-medicos", filteredTopMedicos, "Sin médicos con datos suficientes.", "medico");
  renderFocusCard(filteredRows);
  renderDetail(filteredRows.slice(0, 50));
}

function bindControls() {
  $("search-paciente").addEventListener("input", (event) => {
    state.filters.paciente = event.target.value.trim();
    renderAll();
  });
  $("search-medico").addEventListener("input", (event) => {
    state.filters.medico = event.target.value.trim();
    renderAll();
  });
  $("search-producto").addEventListener("input", (event) => {
    state.filters.producto = event.target.value.trim();
    renderAll();
  });
  $("filter-ventanilla").addEventListener("change", (event) => {
    state.filters.ventanilla = event.target.value;
    renderAll();
  });
  $("btn-clear-filters").addEventListener("click", () => {
    state.filters = { paciente: "", medico: "", producto: "", ventanilla: "" };
    state.focus = { type: "", id: "" };
    $("search-paciente").value = "";
    $("search-medico").value = "";
    $("search-producto").value = "";
    $("filter-ventanilla").value = "";
    renderAll();
  });
}

async function init() {
  const response = await fetch(`data.json?t=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  state.raw = data;
  fillVentanillaFilter(Array.isArray(data.detail) ? data.detail : []);
  bindControls();
  renderAll();
}

init().catch((error) => {
  console.error(error);
  $("mode-badge").textContent = "Error";
  $("meta-fecha").textContent = "Sin datos";
  $("status-box").textContent = "No se pudo cargar data.json.";
});
