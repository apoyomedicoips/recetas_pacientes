"use strict";

const $ = (id) => document.getElementById(id);
const fmtInt = (value) => Number(value || 0).toLocaleString("es-PY");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]);

function renderRanking(targetId, items, emptyMessage, nameKey) {
  const container = $(targetId);
  if (!items || !items.length) {
    container.innerHTML = `<p class="empty-note">${esc(emptyMessage)}</p>`;
    return;
  }
  container.innerHTML = `<div class="ranking-list">${items.map((item, index) => `
    <article class="ranking-item">
      <span class="rank-badge">${index + 1}</span>
      <div>
        <div class="ranking-name">${esc(item[nameKey])}</div>
        <div class="ranking-sub">${fmtInt(item.total_recetas)} recetas · ${fmtInt(item.productos)} renglones · ${fmtInt(item.cantidad_recetada)} recetado</div>
      </div>
      <div class="ranking-val">${fmtInt(item.cantidad_dispensada)} disp.</div>
    </article>`).join("")}</div>`;
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

function renderDashboard(data) {
  const rows = Array.isArray(data.detail) ? data.detail : [];
  const meta = data.metadata || {};
  const topPacientes = Array.isArray(data.top_pacientes) ? data.top_pacientes : [];
  const topMedicos = Array.isArray(data.top_medicos) ? data.top_medicos : [];

  $("mode-badge").textContent = rows.length ? "Snapshot operativo" : "Sin datos";
  $("meta-fecha").textContent = meta.fecha_desde && meta.fecha_corte ? `${meta.fecha_desde} → ${meta.fecha_corte}` : "Sin período";
  $("kpi-recetas").textContent = fmtInt(meta.total_recetas);
  $("kpi-pacientes").textContent = fmtInt(meta.total_pacientes);
  $("kpi-medicos").textContent = fmtInt(meta.total_medicos);
  $("kpi-productos").textContent = fmtInt(meta.total_productos);
  $("kpi-recetado").textContent = fmtInt(meta.total_recetado);
  $("kpi-dispensado").textContent = fmtInt(meta.total_dispensado);
  $("status-box").textContent = `${fmtInt(meta.total_registros)} renglones analizados · mostrando ${fmtInt(rows.length)} recientes`;
  $("top-pacientes-meta").textContent = `${fmtInt(topPacientes.length)} visibles`;
  $("top-medicos-meta").textContent = `${fmtInt(topMedicos.length)} visibles`;

  renderRanking("top-pacientes", topPacientes, "Sin pacientes con datos suficientes.", "paciente_nombre");
  renderRanking("top-medicos", topMedicos, "Sin médicos con datos suficientes.", "medico_nombre");
  renderDetail(rows);
}

async function init() {
  const response = await fetch(`data.json?t=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  renderDashboard(data);
}

init().catch((error) => {
  console.error(error);
  $("mode-badge").textContent = "Error";
  $("meta-fecha").textContent = "Sin datos";
  $("status-box").textContent = "No se pudo cargar data.json.";
});
