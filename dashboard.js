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
  networkIndex: null,
  networkMonthCache: {},
  currentView: "overview",
  patientSearch: "",
  doctorSearch: "",
  selectedPatientId: "",
  selectedDoctorId: "",
  selectedNetworkMonth: "",
  networkDoctorFilter: "",
  networkPatientFilter: "",
  networkProductFilter: "",
  selectedNetworkNode: null,
  networkPlaying: false,
  networkPlayTimer: null,
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
  if (view === "doctors") setTitle("Analisis por medico");
  if (view === "network") setTitle("Red medico, paciente y producto");
}

function renderOverview() {
  if (!state.overview) return;
  const { metadata, kpis } = state.overview;
  $("mode-badge").textContent = "Snapshot";
  $("meta-fecha").textContent = `${metadata.fecha_desde} -> ${metadata.fecha_corte}`;
  $("generated-at").textContent = metadata.generado?.replace("T", " ") || "-";
  $("kpi-recetas").textContent = fmtInt(kpis.total_recetas);
  $("kpi-pacientes").textContent = fmtInt(kpis.total_pacientes);
  $("kpi-medicos").textContent = fmtInt(kpis.total_medicos);
  $("kpi-productos").textContent = fmtInt(kpis.total_productos);
  $("kpi-recetado").textContent = fmtInt(kpis.total_recetado);
  $("kpi-dispensado").textContent = fmtInt(kpis.total_dispensado);

  renderRankingList("top-pacientes", rowsToObjects(state.overview.top_pacientes), "patient");
  renderRankingList("top-medicos", rowsToObjects(state.overview.top_medicos), "doctor");

  $("detail-body").innerHTML = rowsToObjects(state.overview.detail).map((row) => `
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

async function loadNetworkIndex() {
  if (!state.networkIndex) state.networkIndex = await fetchJson("network_index.json");
}

async function loadNetworkMonth(month) {
  const entry = (state.networkIndex?.months || []).find((item) => item.mes === month);
  if (!entry) return null;
  if (!state.networkMonthCache[month]) {
    state.networkMonthCache[month] = await fetchJson(entry.file);
  }
  return state.networkMonthCache[month];
}

function findById(rows, key, id) {
  return rows.find((row) => String(row[key]) === String(id));
}

function patientSummaryRows() {
  return rowsToObjects(state.patientsData?.summary).filter((row) =>
    !state.patientSearch ||
    textIncludes(row.paciente_nombre, state.patientSearch) ||
    textIncludes(row.paciente_id, state.patientSearch)
  );
}

function doctorSummaryRows() {
  return rowsToObjects(state.doctorsData?.summary).filter((row) =>
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
      ? `${fmtInt(row.total_recetas)} recetas · ${fmtInt(row.productos)} productos · ultima ${esc(row.ultima_fecha)}`
      : `${fmtInt(row.total_recetas)} recetas · ${fmtInt(row.pacientes)} pacientes · ultima ${esc(row.ultima_fecha)}`;
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
    $(targetId).innerHTML = `<div class="empty-state">Sin datos historicos para graficar.</div>`;
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

  renderFocusCard("patient-focus", { name: entity.paciente_nombre }, [
    { label: "Cedula", value: esc(entity.paciente_id || "-") },
    { label: "Recetas", value: fmtInt(entity.total_recetas) },
    { label: "Meses activos", value: fmtInt(entity.meses) },
    { label: "Productos", value: fmtInt(entity.productos) },
    { label: "Cant. recetada", value: fmtInt(entity.cantidad_recetada) },
    { label: "Cant. dispensada", value: fmtInt(entity.cantidad_dispensada) },
    { label: "Ultima receta", value: esc(entity.ultima_fecha || "-") },
    { label: "Meses con serie", value: fmtInt(history.length) },
  ], "Historia completa agregada mensualmente.");

  renderMiniTrend("patient-chart", "patient-chart-legend", history, "total_recetas", "Recetas", "cantidad_recetada", "Cant. recetada");
  renderTableBody("patients-history", history, "patient");
}

function renderDoctorsView() {
  const summary = doctorSummaryRows();
  $("doctors-meta").textContent = `${fmtInt(summary.length)} medicos visibles`;
  if (!summary.length) {
    state.selectedDoctorId = "";
    renderList("doctors-list", [], "doctor", "");
    $("doctor-focus").innerHTML = `<div class="empty-state">Sin medicos para mostrar.</div>`;
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

  renderFocusCard("doctor-focus", { name: entity.medico_nombre }, [
    { label: "Codigo", value: esc(entity.medico_id || "-") },
    { label: "Recetas", value: fmtInt(entity.total_recetas) },
    { label: "Meses activos", value: fmtInt(entity.meses) },
    { label: "Pacientes", value: fmtInt(entity.pacientes) },
    { label: "Cant. recetada", value: fmtInt(entity.cantidad_recetada) },
    { label: "Cant. dispensada", value: fmtInt(entity.cantidad_dispensada) },
    { label: "Ultima receta", value: esc(entity.ultima_fecha || "-") },
    { label: "Meses con serie", value: fmtInt(history.length) },
  ], "Actividad completa agregada mensualmente.");

  renderMiniTrend("doctor-chart", "doctor-chart-legend", history, "total_recetas", "Recetas", "cantidad_recetada", "Cant. recetada");
  renderTableBody("doctors-history", history, "doctor");
}

function nodeColor(type) {
  if (type === "medico") return "#1f5d96";
  if (type === "paciente") return "#0f766e";
  return "#d97706";
}

function nodeTint(type, ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  if (type === "medico") return `rgba(31, 93, 150, ${0.25 + clamped * 0.75})`;
  if (type === "paciente") return `rgba(15, 118, 110, ${0.25 + clamped * 0.75})`;
  return `rgba(217, 119, 6, ${0.25 + clamped * 0.75})`;
}

function getNodeLabel(snapshot, type, id) {
  const key = type === "medico" ? "medicos" : type === "paciente" ? "pacientes" : "productos";
  const node = rowsToObjects(snapshot.nodes[key]).find((item) => String(item.id) === String(id));
  return node?.label || id;
}

function renderNetworkKpis(snapshot) {
  $("network-kpis").innerHTML = `
    <span class="network-pill"><strong>${fmtInt(snapshot.kpis.total_recetas)}</strong> recetas</span>
    <span class="network-pill"><strong>${fmtInt(snapshot.kpis.total_medicos)}</strong> medicos</span>
    <span class="network-pill"><strong>${fmtInt(snapshot.kpis.total_pacientes)}</strong> pacientes</span>
    <span class="network-pill"><strong>${fmtInt(snapshot.kpis.total_productos)}</strong> productos</span>
  `;
}

function filteredNodeIds(nodes, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const matches = nodes.filter((node) => textIncludes(node.id, q) || textIncludes(node.label, q)).map((node) => String(node.id));
  return new Set(matches);
}

function hasNetworkFilters() {
  return Boolean(state.networkDoctorFilter || state.networkPatientFilter || state.networkProductFilter);
}

function pickDefaultNetworkPatient(snapshot) {
  const patients = rowsToObjects(snapshot?.nodes?.pacientes)
    .slice()
    .sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0) || String(a.label || a.id).localeCompare(String(b.label || b.id), "es"));
  return patients[0] || null;
}

function ensureDefaultNetworkPatient(snapshot) {
  if (hasNetworkFilters()) return;
  const patient = pickDefaultNetworkPatient(snapshot);
  if (!patient) return;
  state.networkPatientFilter = String(patient.id);
  $("network-patient-filter").value = String(patient.id);
}

const NETWORK_LIMITS = {
  doctors: 10,
  products: 14,
  patients: 6,
};

function buildFilteredNetwork(snapshot) {
  const doctorNodes = rowsToObjects(snapshot.nodes.medicos).map((item) => ({ ...item, type: "medico" }));
  const patientNodes = rowsToObjects(snapshot.nodes.pacientes).map((item) => ({ ...item, type: "paciente" }));
  const productNodes = rowsToObjects(snapshot.nodes.productos).map((item) => ({ ...item, type: "producto" }));

  const doctorFilter = filteredNodeIds(doctorNodes, state.networkDoctorFilter);
  const patientFilter = filteredNodeIds(patientNodes, state.networkPatientFilter);
  const productFilter = filteredNodeIds(productNodes, state.networkProductFilter);

  let mp = rowsToObjects(snapshot.edges.medico_paciente).map((edge) => ({ ...edge, edgeType: "medico_paciente" }));
  let pp = rowsToObjects(snapshot.edges.paciente_producto).map((edge) => ({ ...edge, edgeType: "paciente_producto" }));
  let md = rowsToObjects(snapshot.edges.medico_producto).map((edge) => ({ ...edge, edgeType: "medico_producto" }));

  if (doctorFilter) {
    mp = mp.filter((edge) => doctorFilter.has(String(edge.source)));
    md = md.filter((edge) => doctorFilter.has(String(edge.source)));
  }
  if (patientFilter) {
    mp = mp.filter((edge) => patientFilter.has(String(edge.target)));
    pp = pp.filter((edge) => patientFilter.has(String(edge.source)));
  }
  if (productFilter) {
    pp = pp.filter((edge) => productFilter.has(String(edge.target)));
    md = md.filter((edge) => productFilter.has(String(edge.target)));
  }

  if (doctorFilter && patientFilter && !productFilter) {
    pp = pp.filter((edge) => patientFilter.has(String(edge.source)));
  }
  if (patientFilter) {
    const doctorsSeen = new Set(mp.map((edge) => String(edge.source)));
    const productsSeen = new Set(pp.map((edge) => String(edge.target)));
    md = md.filter((edge) => doctorsSeen.has(String(edge.source)) && productsSeen.has(String(edge.target)));
  }
  if (patientFilter && productFilter && !doctorFilter) {
    mp = mp.filter((edge) => patientFilter.has(String(edge.target)));
  }
  if (doctorFilter && productFilter && !patientFilter) {
    const doctorsSeen = new Set(md.map((edge) => String(edge.source)));
    const productsSeen = new Set(md.map((edge) => String(edge.target)));
    mp = mp.filter((edge) => doctorsSeen.has(String(edge.source)));
    pp = pp.filter((edge) => productsSeen.has(String(edge.target)));
  }

  const usedDoctors = new Set([...mp.map((edge) => String(edge.source)), ...md.map((edge) => String(edge.source))]);
  const usedPatients = new Set([...mp.map((edge) => String(edge.target)), ...pp.map((edge) => String(edge.source))]);
  const usedProducts = new Set([...pp.map((edge) => String(edge.target)), ...md.map((edge) => String(edge.target))]);

  let doctors = doctorNodes.filter((node) => usedDoctors.has(String(node.id)));
  let patients = patientNodes.filter((node) => usedPatients.has(String(node.id)));
  let products = productNodes.filter((node) => usedProducts.has(String(node.id)));

  const matchedPatients = patientFilter
    ? patients.filter((node) => patientFilter.has(String(node.id)))
    : [];
  const focalPatient = matchedPatients.length
    ? matchedPatients.sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))[0]
    : patients.slice().sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))[0] || null;

  if (focalPatient) {
    const focalId = String(focalPatient.id);
    mp = mp
      .filter((edge) => String(edge.target) === focalId)
      .sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))
      .slice(0, NETWORK_LIMITS.doctors);
    pp = pp
      .filter((edge) => String(edge.source) === focalId)
      .sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))
      .slice(0, NETWORK_LIMITS.products);

    const doctorsSeen = new Set(mp.map((edge) => String(edge.source)));
    const productsSeen = new Set(pp.map((edge) => String(edge.target)));
    md = md
      .filter((edge) => doctorsSeen.has(String(edge.source)) && productsSeen.has(String(edge.target)))
      .sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0));
    doctors = doctorNodes.filter((node) => doctorsSeen.has(String(node.id)));
    products = productNodes.filter((node) => productsSeen.has(String(node.id)));
    patients = [focalPatient];
  } else {
    const topPatients = patients
      .slice()
      .sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))
      .slice(0, NETWORK_LIMITS.patients);
    const patientIds = new Set(topPatients.map((node) => String(node.id)));
    mp = mp.filter((edge) => patientIds.has(String(edge.target))).slice(0, NETWORK_LIMITS.doctors * NETWORK_LIMITS.patients);
    pp = pp.filter((edge) => patientIds.has(String(edge.source))).slice(0, NETWORK_LIMITS.products * NETWORK_LIMITS.patients);
    md = [];
    patients = topPatients;
    doctors = doctorNodes.filter((node) => mp.some((edge) => String(edge.source) === String(node.id)));
    products = productNodes.filter((node) => pp.some((edge) => String(edge.target) === String(node.id)));
  }

  return { doctors, patients, products, mp, pp, md, focalPatient };
}

function ensureNetworkSelection(allNodes) {
  const stillExists = allNodes.some((item) =>
    state.selectedNetworkNode &&
    item.type === state.selectedNetworkNode.type &&
    String(item.id) === String(state.selectedNetworkNode.id)
  );
  if (!stillExists) {
    state.selectedNetworkNode = allNodes.find((item) => item.type === "paciente") || allNodes[0] || null;
  }
}

function buildNetworkTooltip(node, stats) {
  return `
    <strong>${esc(node.label || node.id)}</strong>
    <span class="tooltip-type">${esc(node.type)} · ${fmtInt(node.recetas)} recetas</span>
    <div class="tooltip-metrics">
      <span>Conexiones visibles: ${fmtInt(stats.links)}</span>
      <span>Recetas vinculadas: ${fmtInt(stats.recetas)}</span>
      <span>Relaciona con: ${fmtInt(stats.counterparts)} nodos</span>
    </div>
  `;
}

function showNetworkTooltip(event, html) {
  const tooltip = $("network-tooltip");
  tooltip.innerHTML = html;
  tooltip.classList.remove("hidden");
  moveNetworkTooltip(event);
}

function moveNetworkTooltip(event) {
  const tooltip = $("network-tooltip");
  if (tooltip.classList.contains("hidden")) return;
  const maxLeft = window.innerWidth - tooltip.offsetWidth - 16;
  const maxTop = window.innerHeight - tooltip.offsetHeight - 16;
  tooltip.style.left = `${Math.min(event.clientX + 12, Math.max(16, maxLeft))}px`;
  tooltip.style.top = `${Math.min(event.clientY + 12, Math.max(16, maxTop))}px`;
}

function hideNetworkTooltip() {
  $("network-tooltip").classList.add("hidden");
}

function shortNodeLabel(label, max = 28) {
  const text = String(label || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function extractTimelineMonth(snapshot, patientId) {
  const patient = rowsToObjects(snapshot.nodes.pacientes).find((item) => String(item.id) === String(patientId));
  if (!patient) return null;

  const doctorEdge = rowsToObjects(snapshot.edges.medico_paciente)
    .filter((edge) => String(edge.target) === String(patientId))
    .sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))[0];
  const productEdge = rowsToObjects(snapshot.edges.paciente_producto)
    .filter((edge) => String(edge.source) === String(patientId))
    .sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))[0];

  return {
    mes: snapshot.mes,
    recetas: Number(patient.recetas || 0),
    doctor: doctorEdge ? getNodeLabel(snapshot, "medico", doctorEdge.source) : "",
    producto: productEdge ? getNodeLabel(snapshot, "producto", productEdge.target) : "",
  };
}

async function buildNetworkMonthContext(filtered) {
  const patientId = filtered.focalPatient?.id;
  if (!patientId) {
    return { windowMonths: [], timeline: [] };
  }

  const months = state.networkIndex?.months || [];
  const currentIdx = months.findIndex((item) => item.mes === state.selectedNetworkMonth);
  const start = Math.max(0, currentIdx - 2);
  const end = Math.min(months.length, currentIdx + 3);
  const windowMonths = months.slice(start, end);
  const snapshots = await Promise.all(windowMonths.map((item) => loadNetworkMonth(item.mes)));
  const timeline = snapshots.map((item) => extractTimelineMonth(item, patientId));
  return { windowMonths, timeline };
}

function renderNetworkTimeline(monthContext) {
  const root = $("network-timeline");
  const { windowMonths = [], timeline = [] } = monthContext || {};
  if (!windowMonths.length) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = timeline.map((item, idx) => {
    const month = windowMonths[idx].mes;
    if (!item) {
      return `
        <article class="timeline-card empty">
          <div class="timeline-month">${esc(month)}</div>
          <span class="timeline-detail">Sin actividad del paciente en este mes.</span>
          ${month !== state.selectedNetworkMonth ? `<button class="timeline-jump" data-month="${esc(month)}" type="button">Ver mes</button>` : ""}
        </article>
      `;
    }
    return `
      <article class="timeline-card ${month === state.selectedNetworkMonth ? "active" : ""}">
        <div class="timeline-month">${esc(item.mes)}</div>
        <span class="timeline-metric">${fmtInt(item.recetas)} recetas</span>
        <span class="timeline-detail">Médico dominante: ${esc(shortNodeLabel(item.doctor || "-", 24))}</span>
        <span class="timeline-detail">Producto dominante: ${esc(shortNodeLabel(item.producto || "-", 24))}</span>
        ${month !== state.selectedNetworkMonth ? `<button class="timeline-jump" data-month="${esc(month)}" type="button">Ver mes</button>` : ""}
      </article>
    `;
  }).join("");

  root.querySelectorAll(".timeline-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedNetworkMonth = btn.dataset.month;
      state.selectedNetworkNode = null;
      $("network-month").value = btn.dataset.month;
      renderNetworkView();
    });
  });
}

function buildNetworkChronologySvg(monthContext, left, right, y) {
  const { windowMonths = [], timeline = [] } = monthContext || {};
  if (!windowMonths.length) return "";
  const count = windowMonths.length;
  const step = count === 1 ? 0 : (right - left) / (count - 1);
  const points = windowMonths.map((item, idx) => {
    const timelineItem = timeline[idx];
    const active = item.mes === state.selectedNetworkMonth;
    return {
      x: left + step * idx,
      y,
      mes: item.mes,
      recetas: Number(timelineItem?.recetas || 0),
      active,
      empty: !timelineItem,
    };
  });
  const path = points.map((point, idx) => `${idx === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return `
    <g>
      <text x="${left}" y="${y - 22}" font-size="11" font-weight="700" fill="#52677f">Cronologia del paciente foco</text>
      <path d="${path}" fill="none" stroke="#d6e2ef" stroke-width="3" stroke-linecap="round"></path>
      ${points.map((point) => `
        <circle cx="${point.x}" cy="${point.y}" r="${point.active ? 8 : 5.5}" fill="${point.active ? "#1d4ed8" : point.empty ? "#cbd5e1" : "#93c5fd"}" stroke="#ffffff" stroke-width="2"></circle>
        <text x="${point.x}" y="${point.y - 13}" text-anchor="middle" font-size="10" fill="${point.active ? "#1d4ed8" : "#6b7f95"}" font-weight="${point.active ? "700" : "600"}">${esc(point.mes)}</text>
        <text x="${point.x}" y="${point.y + 21}" text-anchor="middle" font-size="10" fill="#52677f">${point.empty ? "sin act." : `${fmtInt(point.recetas)} rec.`}</text>
      `).join("")}
    </g>
  `;
}

function renderNetworkGraph(snapshot, filtered, previousSnapshot, monthContext) {
  const doctors = filtered.doctors;
  const patients = filtered.patients;
  const products = filtered.products;
  const edgeMP = filtered.mp;
  const edgePP = filtered.pp;
  const edgeMD = filtered.md;
  const focalPatient = filtered.focalPatient || patients[0] || null;

  ensureNetworkSelection([...doctors, ...patients, ...products]);
  const selected = state.selectedNetworkNode;
  const selectedKey = selected ? `${selected.type}:${selected.id}` : "";
  const doctorFocusMode = selected?.type === "medico";
  const W = 1180;
  const H = 620;
  const topY = 146;
  const laneHeight = 340;
  const nodeWidth = 206;
  const nodeRadius = 16;
  const xCols = doctorFocusMode
    ? { medico: 160, paciente: 488, producto: 814 }
    : { medico: 70, paciente: 488, producto: 904 };

  const selectedSupportEdges = selected?.type === "medico"
    ? edgeMD
        .filter((edge) => String(edge.source) === String(selected.id))
        .map((edge) => ({ ...edge, sourceType: "medico", targetType: "producto", derived: true }))
    : selected?.type === "producto"
      ? edgeMD
          .filter((edge) => String(edge.target) === String(selected.id))
          .map((edge) => ({ ...edge, sourceType: "medico", targetType: "producto", derived: true }))
      : [];

  const selectedProductIds = new Set(selectedSupportEdges.map((edge) => String(edge.target)));
  const visibleDoctors = doctorFocusMode
    ? doctors.filter((node) => String(node.id) === String(selected.id))
    : doctors;
  const visiblePatients = doctorFocusMode ? [] : patients;
  const visibleProducts = doctorFocusMode
    ? products.filter((node) => selectedProductIds.has(String(node.id)))
    : products;

  const doctorWeight = new Map();
  const productWeight = new Map();
  (doctorFocusMode ? selectedSupportEdges : edgeMP).forEach((edge) => {
    doctorWeight.set(String(edge.source), (doctorWeight.get(String(edge.source)) || 0) + Number(edge.recetas || 0));
  });
  (doctorFocusMode ? selectedSupportEdges : edgePP).forEach((edge) => {
    const key = doctorFocusMode ? edge.target : edge.target;
    productWeight.set(String(key), (productWeight.get(String(key)) || 0) + Number(edge.recetas || 0));
  });

  const sortByWeight = (items, weights) => items.slice().sort((a, b) => {
    const diff = Number(weights.get(String(b.id)) || b.recetas || 0) - Number(weights.get(String(a.id)) || a.recetas || 0);
    return diff || String(a.label || a.id).localeCompare(String(b.label || b.id), "es");
  });

  function stackPositions(nodes, type, weights) {
    const ranked = sortByWeight(nodes, weights);
    const totalWeight = Math.max(ranked.reduce((acc, node) => acc + Number(weights.get(String(node.id)) || node.recetas || 1), 0), 1);
    const gap = 12;
    const available = laneHeight - Math.max(0, ranked.length - 1) * gap;
    let cursor = topY;
    return ranked.map((node, idx) => {
      const weight = Number(weights.get(String(node.id)) || node.recetas || 1);
      const height = ranked.length === 1 ? Math.max(84, available) : Math.max(34, (weight / totalWeight) * available);
      const y = idx === ranked.length - 1 ? topY + laneHeight - height : cursor;
      cursor = y + height + gap;
      return { ...node, x: xCols[type], y, w: nodeWidth, h: height, cy: y + height / 2 };
    });
  }

  const doctorPos = stackPositions(visibleDoctors, "medico", doctorWeight);
  const productPos = stackPositions(visibleProducts, "producto", productWeight);
  const focalPos = !doctorFocusMode && focalPatient ? [{
    ...focalPatient,
    x: xCols.paciente,
    y: topY + laneHeight / 2 - 64,
    w: nodeWidth,
    h: 128,
    cy: topY + laneHeight / 2,
  }] : [];
  const nodeMap = new Map([...doctorPos, ...focalPos, ...productPos].map((item) => [`${item.type}:${item.id}`, item]));

  const allEdges = [
    ...edgeMP.map((edge) => ({ ...edge, sourceType: "medico", targetType: "paciente" })),
    ...edgePP.map((edge) => ({ ...edge, sourceType: "paciente", targetType: "producto" })),
  ];
  const renderedEdges = doctorFocusMode ? selectedSupportEdges : [...allEdges, ...selectedSupportEdges];
  const maxRecipes = Math.max(...renderedEdges.map((edge) => Number(edge.recetas || 0)), 1);
  const nodeStats = new Map();

  const pastEdges = new Set();
  if (previousSnapshot) {
    const prev_mp = rowsToObjects(previousSnapshot.edges.medico_paciente || []);
    const prev_pp = rowsToObjects(previousSnapshot.edges.paciente_producto || []);
    const prev_md = rowsToObjects(previousSnapshot.edges.medico_producto || []);
    prev_mp.forEach(e => pastEdges.add(`medico:${e.source}->paciente:${e.target}`));
    prev_pp.forEach(e => pastEdges.add(`paciente:${e.source}->producto:${e.target}`));
    prev_md.forEach(e => pastEdges.add(`medico:${e.source}->producto:${e.target}`));
  }

  renderedEdges.forEach((edge) => {
    const sourceKey = `${edge.sourceType}:${edge.source}`;
    const targetKey = `${edge.targetType}:${edge.target}`;
    if (!nodeStats.has(sourceKey)) nodeStats.set(sourceKey, { links: 0, recetas: 0, counterparts: new Set() });
    if (!nodeStats.has(targetKey)) nodeStats.set(targetKey, { links: 0, recetas: 0, counterparts: new Set() });
    const recetas = Number(edge.recetas || 0);
    nodeStats.get(sourceKey).links += 1;
    nodeStats.get(sourceKey).recetas += recetas;
    nodeStats.get(sourceKey).counterparts.add(targetKey);
    nodeStats.get(targetKey).links += 1;
    nodeStats.get(targetKey).recetas += recetas;
    nodeStats.get(targetKey).counterparts.add(sourceKey);
  });

  const svgEdges = renderedEdges.map((edge) => {
    const from = nodeMap.get(`${edge.sourceType}:${edge.source}`);
    const to = nodeMap.get(`${edge.targetType}:${edge.target}`);
    if (!from || !to) return "";
    const active = edge.derived || !selectedKey || selectedKey === `${edge.sourceType}:${edge.source}` || selectedKey === `${edge.targetType}:${edge.target}`;
    
    const edgeKey = `${edge.sourceType}:${edge.source}->${edge.targetType}:${edge.target}`;
    const isNew = previousSnapshot ? !pastEdges.has(edgeKey) : false;

    const width = 1 + (Number(edge.recetas || 0) / maxRecipes) * (edge.derived ? 12 : 18);
    const x1 = from.x + from.w;
    const y1 = from.cy;
    const x2 = to.x;
    const y2 = to.cy;
    const cx1 = x1 + (x2 - x1) * 0.28;
    const cx2 = x1 + (x2 - x1) * 0.72;
    
    let stroke = "#d7e3ef";
    if (edge.derived) {
      stroke = "#7c3aed";
    } else if (isNew) {
      stroke = active ? "#10b981" : "rgba(16, 185, 129, 0.35)";
    } else {
      stroke = active ? "#8fb4da" : "#d7e3ef";
    }

    const dash = edge.derived ? ` stroke-dasharray="7 6"` : "";
    const opacity = edge.derived ? 0.82 : active ? (isNew ? 0.95 : 0.82) : 0.18;
    return `<path d="M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}" stroke="${stroke}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" fill="none" opacity="${opacity}"${dash}></path>`;
  }).join("");

  const chronology = buildNetworkChronologySvg(monthContext, 150, W - 150, 110);
  const headings = `
    <text x="${W / 2}" y="40" text-anchor="middle" font-size="18" font-weight="700" fill="#102235">Flujo clinico del mes ${esc(snapshot.mes)}</text>
    <text x="${W / 2}" y="62" text-anchor="middle" font-size="12" fill="#5f738a">${doctorFocusMode ? "Modo foco: medico seleccionado y productos que receto" : "Medicos que prescriben, paciente foco y productos principales del periodo"}</text>
    ${chronology}
    <text x="${xCols.medico + nodeWidth / 2}" y="134" text-anchor="middle" font-size="12" font-weight="700" fill="#1f5d96">${doctorFocusMode ? "Medico seleccionado" : "Medicos"}</text>
    ${doctorFocusMode ? "" : `<text x="${xCols.paciente + nodeWidth / 2}" y="134" text-anchor="middle" font-size="12" font-weight="700" fill="#0f766e">Paciente foco</text>`}
    <text x="${xCols.producto + nodeWidth / 2}" y="134" text-anchor="middle" font-size="12" font-weight="700" fill="#d97706">${doctorFocusMode ? "Productos recetados" : "Productos"}</text>
  `;
  const guides = `
    <rect x="${xCols.medico}" y="${topY}" width="${nodeWidth}" height="${laneHeight}" rx="20" fill="rgba(31,93,150,0.03)" stroke="rgba(31,93,150,0.08)"></rect>
    ${doctorFocusMode ? "" : `<rect x="${xCols.paciente}" y="${topY}" width="${nodeWidth}" height="${laneHeight}" rx="20" fill="rgba(15,118,110,0.03)" stroke="rgba(15,118,110,0.08)"></rect>`}
    <rect x="${xCols.producto}" y="${topY}" width="${nodeWidth}" height="${laneHeight}" rx="20" fill="rgba(217,119,6,0.03)" stroke="rgba(217,119,6,0.08)"></rect>
  `;

  const svgNodes = [...doctorPos, ...focalPos, ...productPos].map((node) => {
    const pool = node.type === "medico" ? visibleDoctors : node.type === "paciente" ? visiblePatients : visibleProducts;
    const maxByType = Math.max(...pool.map((item) => Number(item.recetas || 0)), 1);
    const ratio = Number(node.recetas || 0) / maxByType;
    const color = nodeColor(node.type);
    const active = selectedKey === `${node.type}:${node.id}`;
    const isFocal = focalPatient && node.type === "paciente" && String(node.id) === String(focalPatient.id);
    const fill = active || isFocal ? color : nodeTint(node.type, ratio);
    const textFill = active || isFocal ? "#ffffff" : "#102235";
    const subFill = active || isFocal ? "#dbeafe" : "rgba(16,34,53,0.72)";
    const border = active || isFocal ? color : "rgba(16,34,53,0.12)";
    const stats = nodeStats.get(`${node.type}:${node.id}`) || { links: 0, recetas: 0, counterparts: new Set() };
    return `
      <g class="network-node" data-node-type="${node.type}" data-node-id="${esc(node.id)}" style="cursor:pointer"
         data-node-label="${esc(node.label || node.id)}"
         data-node-recetas="${esc(node.recetas)}"
         data-node-links="${esc(stats.links)}"
         data-node-counterparts="${esc(stats.counterparts.size)}">
        <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${nodeRadius}" fill="${fill}" stroke="${border}" stroke-width="${active ? 2.5 : 1.1}"></rect>
        <text x="${node.x + 14}" y="${node.y + 24}" font-size="11" font-weight="700" fill="${textFill}">${esc(shortNodeLabel(node.label || node.id, node.type === "producto" ? 30 : 26))}</text>
        <text x="${node.x + 14}" y="${node.y + 42}" font-size="10" fill="${subFill}">${fmtInt(node.recetas)} recetas</text>
      </g>
    `;
  }).join("");

  $("network-graph").innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="min-width:${W}px;display:block">${headings}${guides}${svgEdges}${svgNodes}</svg>`;

  $("network-graph").querySelectorAll(".network-node").forEach((nodeEl) => {
    nodeEl.addEventListener("click", () => {
      state.selectedNetworkNode = {
        type: nodeEl.dataset.nodeType,
        id: nodeEl.dataset.nodeId,
      };
      renderNetworkView();
    });
    nodeEl.addEventListener("mouseenter", (event) => {
      showNetworkTooltip(event, buildNetworkTooltip({
        type: nodeEl.dataset.nodeType,
        id: nodeEl.dataset.nodeId,
        label: nodeEl.dataset.nodeLabel,
        recetas: nodeEl.dataset.nodeRecetas,
      }, {
        links: Number(nodeEl.dataset.nodeLinks || 0),
        recetas: Number(nodeEl.dataset.nodeRecetas || 0),
        counterparts: Number(nodeEl.dataset.nodeCounterparts || 0),
      }));
    });
    nodeEl.addEventListener("mousemove", moveNetworkTooltip);
    nodeEl.addEventListener("mouseleave", hideNetworkTooltip);
  });
}

function renderNetworkFocus(snapshot, filtered) {
  if (!state.selectedNetworkNode) {
    $("network-focus").innerHTML = `<div class="empty-state">Seleccione un nodo para analizar relaciones.</div>`;
    return;
  }
  const { type, id } = state.selectedNetworkNode;
  const label = getNodeLabel(snapshot, type, id);
  const edges = [
    ...filtered.mp.map((item) => ({ ...item, edgeType: "medico_paciente" })),
    ...filtered.pp.map((item) => ({ ...item, edgeType: "paciente_producto" })),
    ...filtered.md.map((item) => ({ ...item, edgeType: "medico_producto" })),
  ].filter((edge) => String(edge.source) === String(id) || String(edge.target) === String(id));

  const totalLinks = edges.length;
  const totalRecipes = edges.reduce((acc, edge) => acc + Number(edge.recetas || 0), 0);
  const counterpartTypes = new Set(edges.map((edge) => {
    if (type === "medico") return edge.edgeType === "medico_paciente" ? "pacientes" : "productos";
    if (type === "paciente") return edge.edgeType === "medico_paciente" ? "medicos" : "productos";
    return edge.edgeType === "paciente_producto" ? "pacientes" : "medicos";
  }));

  $("network-focus").innerHTML = `
    <div class="network-focus-card">
      <div class="network-focus-title">${esc(label)}</div>
      <div class="network-focus-type">${esc(type)} · ${esc(snapshot.mes)}</div>
      <div class="network-badges">
        <div class="network-badge"><span>Conexiones</span><strong>${fmtInt(totalLinks)}</strong></div>
        <div class="network-badge"><span>Recetas</span><strong>${fmtInt(totalRecipes)}</strong></div>
        <div class="network-badge"><span>Relaciona con</span><strong>${esc([...counterpartTypes].join(" / ") || "-")}</strong></div>
      </div>
    </div>
  `;
}

function renderNetworkLinks(snapshot, filtered) {
  const body = $("network-links-body");
  const selected = state.selectedNetworkNode;
  const edges = [
    ...filtered.mp.map((item) => ({ ...item, edgeType: "Medico -> Paciente", sourceType: "medico", targetType: "paciente" })),
    ...filtered.pp.map((item) => ({ ...item, edgeType: "Paciente -> Producto", sourceType: "paciente", targetType: "producto" })),
    ...filtered.md.map((item) => ({ ...item, edgeType: "Medico -> Producto", sourceType: "medico", targetType: "producto" })),
  ].filter((edge) => {
    if (!selected) return true;
    return String(edge.source) === String(selected.id) || String(edge.target) === String(selected.id);
  }).sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0)).slice(0, 20);

  if (!edges.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty-state">Sin conexiones visibles para este nodo.</td></tr>`;
    return;
  }

  body.innerHTML = edges.map((edge) => `
    <tr>
      <td>${esc(getNodeLabel(snapshot, edge.sourceType, edge.source))}</td>
      <td>${esc(getNodeLabel(snapshot, edge.targetType, edge.target))}</td>
      <td>${esc(edge.edgeType)}</td>
      <td class="num">${fmtInt(edge.recetas)}</td>
    </tr>
  `).join("");
}

function ratioLabel(part, total) {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function buildNetworkAlerts(snapshot, filtered) {
  const alerts = [];

  const doctorTotals = new Map();
  const patientTotals = new Map();
  const productDoctorSet = new Map();

  filtered.mp.forEach((edge) => {
    const recetas = Number(edge.recetas || 0);
    if (!doctorTotals.has(edge.source)) doctorTotals.set(edge.source, { total: 0, max: 0, patientId: "" });
    const doctor = doctorTotals.get(edge.source);
    doctor.total += recetas;
    if (recetas > doctor.max) {
      doctor.max = recetas;
      doctor.patientId = edge.target;
    }
  });

  filtered.pp.forEach((edge) => {
    const recetas = Number(edge.recetas || 0);
    if (!patientTotals.has(edge.source)) patientTotals.set(edge.source, { total: 0, products: 0, topProductId: "", topProductValue: 0 });
    const patient = patientTotals.get(edge.source);
    patient.total += recetas;
    patient.products += 1;
    if (recetas > patient.topProductValue) {
      patient.topProductValue = recetas;
      patient.topProductId = edge.target;
    }
  });

  filtered.md.forEach((edge) => {
    const key = String(edge.target);
    if (!productDoctorSet.has(key)) productDoctorSet.set(key, { doctors: new Set(), total: 0 });
    const bucket = productDoctorSet.get(key);
    bucket.doctors.add(String(edge.source));
    bucket.total += Number(edge.recetas || 0);
  });

  let mostConcentratedDoctor = null;
  doctorTotals.forEach((value, key) => {
    const ratio = value.total ? value.max / value.total : 0;
    if (!mostConcentratedDoctor || ratio > mostConcentratedDoctor.ratio) {
      mostConcentratedDoctor = { doctorId: key, ratio, total: value.total, patientId: value.patientId, max: value.max };
    }
  });
  if (mostConcentratedDoctor) {
    alerts.push({
      tone: mostConcentratedDoctor.ratio >= 0.6 ? "risk" : "warn",
      title: "Concentracion medico-paciente",
      text: `${getNodeLabel(snapshot, "medico", mostConcentratedDoctor.doctorId)} concentra ${ratioLabel(mostConcentratedDoctor.max, mostConcentratedDoctor.total)} de sus recetas visibles en ${getNodeLabel(snapshot, "paciente", mostConcentratedDoctor.patientId)}.`,
    });
  }

  let mostPolypharmacy = null;
  patientTotals.forEach((value, key) => {
    if (!mostPolypharmacy || value.products > mostPolypharmacy.products || (value.products === mostPolypharmacy.products && value.total > mostPolypharmacy.total)) {
      mostPolypharmacy = { patientId: key, ...value };
    }
  });
  if (mostPolypharmacy) {
    alerts.push({
      tone: mostPolypharmacy.products >= 6 ? "risk" : "info",
      title: "Paciente con mayor polifarmacia",
      text: `${getNodeLabel(snapshot, "paciente", mostPolypharmacy.patientId)} conecta con ${fmtInt(mostPolypharmacy.products)} productos en la subred visible.`,
    });
  }

  let mostDependentProduct = null;
  productDoctorSet.forEach((value, key) => {
    if (!mostDependentProduct || value.doctors.size < mostDependentProduct.doctors || (value.doctors.size === mostDependentProduct.doctors && value.total > mostDependentProduct.total)) {
      mostDependentProduct = { productId: key, doctors: value.doctors.size, total: value.total };
    }
  });
  if (mostDependentProduct) {
    alerts.push({
      tone: mostDependentProduct.doctors <= 2 ? "warn" : "info",
      title: "Producto dependiente de pocos medicos",
      text: `${getNodeLabel(snapshot, "producto", mostDependentProduct.productId)} depende de ${fmtInt(mostDependentProduct.doctors)} medicos visibles para ${fmtInt(mostDependentProduct.total)} recetas.`,
    });
  }

  const dominantEdge = [
    ...filtered.mp.map((edge) => ({ ...edge, label: "Medico -> Paciente", sourceType: "medico", targetType: "paciente" })),
    ...filtered.pp.map((edge) => ({ ...edge, label: "Paciente -> Producto", sourceType: "paciente", targetType: "producto" })),
    ...filtered.md.map((edge) => ({ ...edge, label: "Medico -> Producto", sourceType: "medico", targetType: "producto" })),
  ].sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0))[0];
  if (dominantEdge) {
    alerts.push({
      tone: "info",
      title: "Vinculo dominante",
      text: `${dominantEdge.label}: ${getNodeLabel(snapshot, dominantEdge.sourceType, dominantEdge.source)} con ${getNodeLabel(snapshot, dominantEdge.targetType, dominantEdge.target)} suma ${fmtInt(dominantEdge.recetas)} recetas.`,
    });
  }

  return alerts;
}

function renderNetworkAlerts(snapshot, filtered) {
  const alerts = buildNetworkAlerts(snapshot, filtered);
  $("network-alerts").innerHTML = alerts.length
    ? alerts.map((alert) => `
      <article class="alert-card ${esc(alert.tone)}">
        <strong>${esc(alert.title)}</strong>
        <p>${esc(alert.text)}</p>
      </article>
    `).join("")
    : `<article class="alert-card info"><strong>Sin alertas</strong><p>No hay suficiente densidad en la subred visible para construir señales gerenciales.</p></article>`;
}

function renderNetworkScrubber() {
  const months = state.networkIndex?.months || [];
  if (!state.selectedNetworkMonth && months.length) state.selectedNetworkMonth = months[0].mes;
  
  $("network-month").innerHTML = months.map((item) => `<option value="${esc(item.mes)}">${esc(item.mes)}</option>`).join("");
  $("network-month").value = state.selectedNetworkMonth;

  const maxRecetas = Math.max(...months.map(m => m.total_recetas), 1);
  const container = $("network-scrubber-bars");
  if (!container) return;
  const chronologicalMonths = [...months].reverse();
  
  container.innerHTML = chronologicalMonths.map(mon => {
    const heightPct = Math.max(10, (mon.total_recetas / maxRecetas) * 100);
    const activeClass = mon.mes === state.selectedNetworkMonth ? "active" : "";
    return `
      <div class="scrubber-bar-container ${activeClass}" data-month="${esc(mon.mes)}">
        <div class="scrubber-bar" style="height: ${heightPct}%"></div>
        <div class="scrubber-tooltip">${esc(mon.mes)}<br>${fmtInt(mon.total_recetas)} recetas</div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".scrubber-bar-container").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedNetworkMonth = el.dataset.month;
      state.networkDoctorFilter = "";
      state.networkPatientFilter = "";
      state.networkProductFilter = "";
      state.selectedNetworkNode = null;
      $("network-doctor-filter").value = "";
      $("network-patient-filter").value = "";
      $("network-product-filter").value = "";
      renderNetworkView();
    });
  });
}

function toggleNetworkPlay() {
  const btn = $("network-play-btn");
  if (!btn) return;
  if (state.networkPlaying) {
    state.networkPlaying = false;
    btn.innerHTML = "▶";
    btn.classList.remove("playing");
    clearInterval(state.networkPlayTimer);
  } else {
    state.networkPlaying = true;
    btn.innerHTML = "⏸";
    btn.classList.add("playing");
    state.networkPlayTimer = setInterval(advanceNetworkMonth, 2200);
  }
}

function advanceNetworkMonth() {
  const months = state.networkIndex?.months || [];
  if (!months.length) return;
  const reverseMonths = [...months].reverse();
  const currentIndex = reverseMonths.findIndex(m => m.mes === state.selectedNetworkMonth);
  const nextIndex = (currentIndex + 1) % reverseMonths.length;
  
  state.selectedNetworkMonth = reverseMonths[nextIndex].mes;
  state.networkDoctorFilter = "";
  state.networkPatientFilter = "";
  state.networkProductFilter = "";
  state.selectedNetworkNode = null;
  $("network-doctor-filter").value = "";
  $("network-patient-filter").value = "";
  $("network-product-filter").value = "";
  
  renderNetworkView();
}

function populateNetworkDatalists(snapshot) {
  const fill = (id, rows) => {
    $(id).innerHTML = rows.slice(0, 400).map((row) => `<option value="${esc(row.id)}">${esc(row.label)}</option>`).join("");
  };
  fill("network-doctors-list", rowsToObjects(snapshot.nodes.medicos));
  fill("network-patients-list", rowsToObjects(snapshot.nodes.pacientes));
  fill("network-products-list", rowsToObjects(snapshot.nodes.productos));
}

async function renderNetworkView() {
  const snapshot = await loadNetworkMonth(state.selectedNetworkMonth);
  if (!snapshot) return;

  const months = state.networkIndex?.months || [];
  const currentIndex = months.findIndex((item) => item.mes === state.selectedNetworkMonth);
  let previousSnapshot = null;
  if (currentIndex >= 0 && currentIndex < months.length - 1) {
    previousSnapshot = await loadNetworkMonth(months[currentIndex + 1].mes);
  }

  ensureDefaultNetworkPatient(snapshot);
  const filtered = buildFilteredNetwork(snapshot);
  const patientLabel = filtered.focalPatient ? (filtered.focalPatient.label || filtered.focalPatient.id) : "sin foco";
  $("network-meta").textContent = `Mes ${snapshot.mes} · foco ${patientLabel}`;
  renderNetworkScrubber();
  populateNetworkDatalists(snapshot);
  renderNetworkKpis(snapshot);
  
  const monthContext = await buildNetworkMonthContext(filtered);

  renderNetworkGraph(snapshot, filtered, previousSnapshot, monthContext);
  renderNetworkTimeline(monthContext);
  renderNetworkAlerts(snapshot, filtered);
  renderNetworkFocus(snapshot, filtered);
  renderNetworkLinks(snapshot, filtered);
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

async function openNetworkView() {
  setActiveView("network");
  await loadNetworkIndex();
  renderNetworkMonthOptions();
  await renderNetworkView();
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
      if (view === "network") await openNetworkView();
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

  $("network-play-btn")?.addEventListener("click", toggleNetworkPlay);

  $("network-month").addEventListener("change", () => {
    state.selectedNetworkMonth = $("network-month").value;
    state.networkDoctorFilter = "";
    state.networkPatientFilter = "";
    state.networkProductFilter = "";
    state.selectedNetworkNode = null;
    $("network-doctor-filter").value = "";
    $("network-patient-filter").value = "";
    $("network-product-filter").value = "";
    renderNetworkView();
  });

  $("network-doctor-filter").addEventListener("input", () => {
    state.networkDoctorFilter = $("network-doctor-filter").value.trim();
    state.selectedNetworkNode = null;
    renderNetworkView();
  });

  $("network-patient-filter").addEventListener("input", () => {
    state.networkPatientFilter = $("network-patient-filter").value.trim();
    state.selectedNetworkNode = null;
    renderNetworkView();
  });

  $("network-product-filter").addEventListener("input", () => {
    state.networkProductFilter = $("network-product-filter").value.trim();
    state.selectedNetworkNode = null;
    renderNetworkView();
  });

  $("network-clear-filters").addEventListener("click", () => {
    state.networkDoctorFilter = "";
    state.networkPatientFilter = "";
    state.networkProductFilter = "";
    state.selectedNetworkNode = null;
    $("network-doctor-filter").value = "";
    $("network-patient-filter").value = "";
    $("network-product-filter").value = "";
    renderNetworkView();
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
