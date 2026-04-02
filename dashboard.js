"use strict";

const $ = (id) => document.getElementById(id);
const fmtInt = (value) => Number(value || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
const fmtDec = (value) => Number(value || 0).toLocaleString("es-PY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[ch]));

const state = {
  overview: null,
  patientsData: null,
  doctorsData: null,
  currentView: "overview",
  patientSearch: "",
  doctorSearch: "",
  selectedPatientId: "",
  selectedDoctorId: "",
};

function rowsToObjects(block) {
  if (!block || !Array.isArray(block.cols) || !Array.isArray(block.rows)) return [];
  return block.rows.map((row) => Object.fromEntries(block.cols.map((col, idx) => [col, row[idx]])));
}

function textIncludes(value, query) {
  return String(value ?? "").toLowerCase().includes(String(query ?? "").trim().toLowerCase());
}

async function fetchJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function setTitle(title) {
  $("view-title").textContent = title;
}

function setActiveView(view) {
  state.currentView = view;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  if (view === "overview") setTitle("Resumen ejecutivo");
  if (view === "patients") setTitle("Historias por paciente");
  if (view === "doctors") setTitle("Análisis por médico");
}

function renderOverview() {
  if (!state.overview) return;
  const { metadata, kpis } = state.overview;
  $("mode-badge").textContent = "Snapshot";
  $("meta-fecha").textContent = `${metadata.fecha_desde} → ${metadata.fecha_corte}`;
  $("generated-at").textContent = metadata.generado?.replace("T", " ") || "—";
  $("kpi-recetas").textContent = fmtInt(kpis.total_recetas);
  $("kpi-pacientes").textContent = fmtInt(kpis.total_pacientes);
  $("kpi-medicos").textContent = fmtInt(kpis.total_medicos);
  $("kpi-productos").textContent = fmtInt(kpis.total_productos);
  $("kpi-recetado").textContent = fmtInt(kpis.total_recetado);
  $("kpi-dispensado").textContent = fmtInt(kpis.total_dispensado);

  renderRankingList("top-pacientes", rowsToObjects(state.overview.top_pacientes), "patient");
  renderRankingList("top-medicos", rowsToObjects(state.overview.top_medicos), "doctor");

  const detailRows = rowsToObjects(state.overview.detail);
  $("detail-body").innerHTML = detailRows.map((row) => `
    <tr>
      <td>${esc(row.fecha)}</td>
      <td>${esc(row.receta_id)}</td>
      <td>${esc(row.paciente_nombre || row.paciente_id)}</td>
      <td>${esc(row.medico_nombre || row.medico_id)}</td>
      <td>${esc(row.producto)}</td>
      <td class="num">${fmtInt(row.cantidad_recetada)}</td>
      <td class="num">${fmtInt(row.cantidad_dispensada)}</td>
      <td>${esc(row.ventanilla)}</td>
    </tr>
  `).join("");
}

function renderRankingList(targetId, rows, type) {
  const root = $(targetId);
  if (!rows.length) {
    root.innerHTML = `<div class="empty-state">Sin datos.</div>`;
    return;
  }
  root.innerHTML = `<div class="ranking-list">${rows.map((row, idx) => `
    <button class="rank-btn" data-type="${type}" data-id="${esc(type === "patient" ? row.paciente_id : row.medico_id)}">
      <div class="rank-row">
        <span class="rank-pill">${idx + 1}</span>
        <div>
          <div class="list-title">${esc(type === "patient" ? row.paciente_nombre : row.medico_nombre)}</div>
          <div class="list-sub">${fmtInt(row.total_recetas)} recetas · ${fmtInt(type === "patient" ? row.productos : row.pacientes)} ${type === "patient" ? "productos" : "pacientes"}</div>
        </div>
      </div>
    </button>
  `).join("")}</div>`;

  root.querySelectorAll(".rank-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.type === "patient") {
        state.selectedPatientId = btn.dataset.id;
        await openPatientsView();
      } else {
        state.selectedDoctorId = btn.dataset.id;
        await openDoctorsView();
      }
    });
  });
}

async function loadPatientsData() {
  if (!state.patientsData) state.patientsData = await fetchJson("pacientes_data.json");
}

async function loadDoctorsData() {
  if (!state.doctorsData) state.doctorsData = await fetchJson("medicos_data.json");
}

function findById(rows, key, id) {
  return rows.find((row) => String(row[key]) === String(id));
}

function patientSummaryRows() {
  const rows = rowsToObjects(state.patientsData?.summary);
  return rows.filter((row) =>
    !state.patientSearch ||
    textIncludes(row.paciente_nombre, state.patientSearch) ||
    textIncludes(row.paciente_id, state.patientSearch)
  );
}

function doctorSummaryRows() {
  const rows = rowsToObjects(state.doctorsData?.summary);
  return rows.filter((row) =>
    !state.doctorSearch ||
    textIncludes(row.medico_nombre, state.doctorSearch) ||
    textIncludes(row.medico_id, state.doctorSearch)
  );
}

function patientMonthlyRows(patientId) {
  return rowsToObjects(state.patientsData?.monthly)
    .filter((row) => String(row.paciente_id) === String(patientId))
    .sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
}

function doctorMonthlyRows(doctorId) {
  return rowsToObjects(state.doctorsData?.monthly)
    .filter((row) => String(row.medico_id) === String(doctorId))
    .sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
}

function renderList(targetId, rows, type, selectedId) {
  const root = $(targetId);
  if (!rows.length) {
    root.innerHTML = `<div class="empty-state">Sin coincidencias.</div>`;
    return;
  }
  root.innerHTML = rows.slice(0, 150).map((row) => {
    const id = type === "patient" ? row.paciente_id : row.medico_id;
    const name = type === "patient" ? row.paciente_nombre : row.medico_nombre;
    const sub = type === "patient"
      ? `${fmtInt(row.total_recetas)} recetas · ${fmtInt(row.productos)} productos · última ${esc(row.ultima_fecha)}`
      : `${fmtInt(row.total_recetas)} recetas · ${fmtInt(row.pacientes)} pacientes · última ${esc(row.ultima_fecha)}`;
    return `
      <button class="list-item ${String(selectedId) === String(id) ? "active" : ""}" data-id="${esc(id)}" data-type="${type}">
        <div class="list-title">${esc(name)}</div>
        <div class="list-sub">${sub}</div>
      </button>
    `;
  }).join("");

  root.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.type === "patient") {
        state.selectedPatientId = btn.dataset.id;
        renderPatientsView();
      } else {
        state.selectedDoctorId = btn.dataset.id;
        renderDoctorsView();
      }
    });
  });
}

function renderFocusCard(targetId, entity, metrics, subtitle) {
  $(targetId).innerHTML = `
    <div class="focus-card">
      <div class="focus-hero">
        <h4>${esc(entity.name)}</h4>
        <div class="focus-sub">${esc(subtitle)}</div>
      </div>
      <div class="focus-metrics">
        ${metrics.map((metric) => `
          <div class="metric-box">
            <span>${esc(metric.label)}</span>
            <strong>${metric.value}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMiniTrend(targetId, legendId, rows, seriesAKey, seriesALabel, seriesBKey, seriesBLabel) {
  if (!rows.length) {
    $(targetId).innerHTML = `<div class="empty-state">Sin datos históricos para graficar.</div>`;
    $(legendId).innerHTML = "";
    return;
  }

  const labels = rows.map((row) => row.mes);
  const seriesA = rows.map((row) => Number(row[seriesAKey] || 0));
  const seriesB = rows.map((row) => Number(row[seriesBKey] || 0));
  const all = [...seriesA, ...seriesB];
  const maxY = Math.max(...all, 1);
  const W = 860;
  const H = 240;
  const pL = 48;
  const pR = 18;
  const pT = 16;
  const pB = 34;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const xAt = (idx) => pL + (labels.length === 1 ? cW / 2 : (idx / (labels.length - 1)) * cW);
  const yAt = (value) => pT + cH - (value / maxY) * cH;

  const points = (arr) => arr.map((value, idx) => `${xAt(idx).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ");
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  for (let i = 0; i <= 4; i++) {
    const y = pT + (i / 4) * cH;
    svg += `<line x1="${pL}" x2="${W - pR}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
    svg += `<text x="${pL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#7a8da3">${fmtInt(Math.round(maxY * (1 - i / 4)))}</text>`;
  }

  const tickStep = Math.max(1, Math.floor(labels.length / 8));
  labels.forEach((label, idx) => {
    if (idx % tickStep === 0 || idx === labels.length - 1) {
      svg += `<text x="${xAt(idx)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#7a8da3">${esc(label)}</text>`;
    }
  });

  svg += `<polyline points="${points(seriesA)}" fill="none" stroke="#1f5d96" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<polyline points="${points(seriesB)}" fill="none" stroke="#d97706" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `</svg>`;
  $(targetId).innerHTML = svg;
  $(legendId).innerHTML = `
    <span><span class="legend-dot" style="background:#1f5d96"></span>${esc(seriesALabel)}</span>
    <span><span class="legend-dot" style="background:#d97706"></span>${esc(seriesBLabel)}</span>
  `;
}

function renderTableBody(targetId, rows, mode) {
  if (!rows.length) {
    $(targetId).innerHTML = `<tr><td colspan="6" class="empty-state">Sin historia disponible.</td></tr>`;
    return;
  }
  $(targetId).innerHTML = rows.map((row) => {
    const third = mode === "patient" ? row.medicos : row.pacientes;
    return `
      <tr>
        <td>${esc(row.mes)}</td>
        <td class="num">${fmtInt(row.total_recetas)}</td>
        <td class="num">${fmtInt(row.productos)}</td>
        <td class="num">${fmtInt(third)}</td>
        <td class="num">${fmtDec(row.cantidad_recetada)}</td>
        <td class="num">${fmtDec(row.cantidad_dispensada)}</td>
      </tr>
    `;
  }).join("");
}

function renderPatientsView() {
  const summary = patientSummaryRows();
  $("patients-meta").textContent = `${fmtInt(summary.length)} pacientes visibles`;
  if (!summary.length) {
    state.selectedPatientId = "";
    renderList("patients-list", [], "patient", "");
    $("patient-focus").innerHTML = `<div class="empty-state">Sin pacientes para mostrar.</div>`;
    $("patients-history").innerHTML = "";
    $("patient-chart").innerHTML = "";
    $("patient-chart-legend").innerHTML = "";
    return;
  }

  if (!findById(summary, "paciente_id", state.selectedPatientId)) {
    state.selectedPatientId = summary[0].paciente_id;
  }

  renderList("patients-list", summary, "patient", state.selectedPatientId);
  const entity = findById(summary, "paciente_id", state.selectedPatientId);
  const history = patientMonthlyRows(state.selectedPatientId);

  renderFocusCard("patient-focus", {
    name: entity.paciente_nombre,
  }, [
    { label: "Cédula", value: esc(entity.paciente_id || "—") },
    { label: "Recetas", value: fmtInt(entity.total_recetas) },
    { label: "Meses activos", value: fmtInt(entity.meses) },
    { label: "Productos", value: fmtInt(entity.productos) },
    { label: "Cant. recetada", value: fmtInt(entity.cantidad_recetada) },
    { label: "Cant. dispensada", value: fmtInt(entity.cantidad_dispensada) },
    { label: "Última receta", value: esc(entity.ultima_fecha || "—") },
    { label: "Meses con serie", value: fmtInt(history.length) },
  ], "Historia completa agregada mensualmente.");

  renderMiniTrend("patient-chart", "patient-chart-legend", history, "total_recetas", "Recetas", "cantidad_recetada", "Cant. recetada");
  renderTableBody("patients-history", history, "patient");
}

function renderDoctorsView() {
  const summary = doctorSummaryRows();
  $("doctors-meta").textContent = `${fmtInt(summary.length)} médicos visibles`;
  if (!summary.length) {
    state.selectedDoctorId = "";
    renderList("doctors-list", [], "doctor", "");
    $("doctor-focus").innerHTML = `<div class="empty-state">Sin médicos para mostrar.</div>`;
    $("doctors-history").innerHTML = "";
    $("doctor-chart").innerHTML = "";
    $("doctor-chart-legend").innerHTML = "";
    return;
  }

  if (!findById(summary, "medico_id", state.selectedDoctorId)) {
    state.selectedDoctorId = summary[0].medico_id;
  }

  renderList("doctors-list", summary, "doctor", state.selectedDoctorId);
  const entity = findById(summary, "medico_id", state.selectedDoctorId);
  const history = doctorMonthlyRows(state.selectedDoctorId);

  renderFocusCard("doctor-focus", {
    name: entity.medico_nombre,
  }, [
    { label: "Código", value: esc(entity.medico_id || "—") },
    { label: "Recetas", value: fmtInt(entity.total_recetas) },
    { label: "Meses activos", value: fmtInt(entity.meses) },
    { label: "Pacientes", value: fmtInt(entity.pacientes) },
    { label: "Cant. recetada", value: fmtInt(entity.cantidad_recetada) },
    { label: "Cant. dispensada", value: fmtInt(entity.cantidad_dispensada) },
    { label: "Última receta", value: esc(entity.ultima_fecha || "—") },
    { label: "Meses con serie", value: fmtInt(history.length) },
  ], "Actividad completa agregada mensualmente.");

  renderMiniTrend("doctor-chart", "doctor-chart-legend", history, "total_recetas", "Recetas", "cantidad_recetada", "Cant. recetada");
  renderTableBody("doctors-history", history, "doctor");
}

async function openPatientsView() {
  setActiveView("patients");
  await loadPatientsData();
  renderPatientsView();
}

async function openDoctorsView() {
  setActiveView("doctors");
  await loadDoctorsData();
  renderDoctorsView();
}

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { view } = btn.dataset;
      if (view === "overview") {
        setActiveView("overview");
        return;
      }
      if (view === "patients") await openPatientsView();
      if (view === "doctors") await openDoctorsView();
    });
  });

  $("patients-search").addEventListener("input", () => {
    state.patientSearch = $("patients-search").value.trim();
    renderPatientsView();
  });

  $("doctors-search").addEventListener("input", () => {
    state.doctorSearch = $("doctors-search").value.trim();
    renderDoctorsView();
  });
}

async function init() {
  state.overview = await fetchJson("data.json");
  bindEvents();
  renderOverview();
  setActiveView("overview");
}

init().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;font-family:Segoe UI,Tahoma,sans-serif">
    <h2 style="color:#b91c1c">Error al iniciar</h2>
    <pre>${esc(err.message)}</pre>
  </div>`;
});
