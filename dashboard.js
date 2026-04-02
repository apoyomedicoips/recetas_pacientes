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

  const noFilters = !doctorFilter && !patientFilter && !productFilter;
  if (noFilters) {
    doctors = doctors.slice(0, 14);
    patients = patients.slice(0, 24);
    products = products.slice(0, 16);
    const doctorIds = new Set(doctors.map((node) => String(node.id)));
    const patientIds = new Set(patients.map((node) => String(node.id)));
    const productIds = new Set(products.map((node) => String(node.id)));
    mp = mp.filter((edge) => doctorIds.has(String(edge.source)) && patientIds.has(String(edge.target)));
    pp = pp.filter((edge) => patientIds.has(String(edge.source)) && productIds.has(String(edge.target)));
    md = md.filter((edge) => doctorIds.has(String(edge.source)) && productIds.has(String(edge.target)));
  }

  return { doctors, patients, products, mp, pp, md };
}

function ensureNetworkSelection(allNodes) {
  const stillExists = allNodes.some((item) =>
    state.selectedNetworkNode &&
    item.type === state.selectedNetworkNode.type &&
    String(item.id) === String(state.selectedNetworkNode.id)
  );
  if (!stillExists) state.selectedNetworkNode = allNodes[0] || null;
}

function renderNetworkGraph(snapshot, filtered) {
  const doctors = filtered.doctors;
  const patients = filtered.patients;
  const products = filtered.products;
  const edgeMP = filtered.mp;
  const edgePP = filtered.pp;
  const edgeMD = filtered.md;

  ensureNetworkSelection([...doctors, ...patients, ...products]);
  const selected = state.selectedNetworkNode;

  const W = 1240;
  const H = 560;
  const colX = { medico: 180, paciente: 620, producto: 1060 };
  const laneTop = 80;
  const laneBottom = H - 36;

  function makePositions(nodes, type) {
    const step = nodes.length > 1 ? (laneBottom - laneTop) / (nodes.length - 1) : 0;
    return nodes.map((node, idx) => ({ ...node, x: colX[type], y: laneTop + step * idx }));
  }

  const doctorPos = makePositions(doctors, "medico");
  const patientPos = makePositions(patients, "paciente");
  const productPos = makePositions(products, "producto");
  const nodeMap = new Map([...doctorPos, ...patientPos, ...productPos].map((item) => [`${item.type}:${item.id}`, item]));

  const allEdges = [
    ...edgeMP.map((edge) => ({ ...edge, sourceType: "medico", targetType: "paciente" })),
    ...edgePP.map((edge) => ({ ...edge, sourceType: "paciente", targetType: "producto" })),
    ...edgeMD.map((edge) => ({ ...edge, sourceType: "medico", targetType: "producto", arc: true })),
  ];
  const maxRecipes = Math.max(...allEdges.map((edge) => Number(edge.recetas || 0)), 1);
  const selectedKey = selected ? `${selected.type}:${selected.id}` : "";

  const svgEdges = allEdges.map((edge) => {
    const from = nodeMap.get(`${edge.sourceType}:${edge.source}`);
    const to = nodeMap.get(`${edge.targetType}:${edge.target}`);
    if (!from || !to) return "";
    const active = !selectedKey || selectedKey === `${edge.sourceType}:${edge.source}` || selectedKey === `${edge.targetType}:${edge.target}`;
    const width = 1 + (Number(edge.recetas || 0) / maxRecipes) * 6;
    if (edge.arc) {
      const cx = (from.x + to.x) / 2;
      const cy = Math.min(from.y, to.y) - 40;
      return `<path d="M ${from.x + 50} ${from.y} Q ${cx} ${cy} ${to.x - 50} ${to.y}" stroke="${active ? "#c0b2db" : "#e2d9ef"}" stroke-width="${Math.max(1, width - 1).toFixed(2)}" fill="none" opacity="${active ? 0.85 : 0.22}"></path>`;
    }
    return `<line x1="${from.x + 50}" y1="${from.y}" x2="${to.x - 50}" y2="${to.y}" stroke="${active ? "#8fb4da" : "#d7e3ef"}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" opacity="${active ? 0.92 : 0.28}"></line>`;
  }).join("");

  const headings = [
    { label: "Medicos", x: colX.medico },
    { label: "Pacientes", x: colX.paciente },
    { label: "Productos", x: colX.producto },
  ].map((item) => `<text x="${item.x}" y="34" text-anchor="middle" font-size="18" font-weight="700" fill="#102235">${item.label}</text>`).join("");

  const svgNodes = [...doctorPos, ...patientPos, ...productPos].map((node) => {
    const maxByType = Math.max(...(node.type === "medico" ? doctors : node.type === "paciente" ? patients : products).map((item) => Number(item.recetas || 0)), 1);
    const ratio = Number(node.recetas || 0) / maxByType;
    const color = nodeColor(node.type);
    const active = selectedKey === `${node.type}:${node.id}`;
    const fill = active ? color : nodeTint(node.type, ratio);
    const textFill = active ? "#ffffff" : "#102235";
    const border = active ? color : "rgba(16,34,53,0.12)";
    const radius = 13 + ratio * 18;
    return `
      <g class="network-node" data-node-type="${node.type}" data-node-id="${esc(node.id)}" style="cursor:pointer">
        <circle cx="${node.x}" cy="${node.y}" r="${radius.toFixed(1)}" fill="${fill}" stroke="${border}" stroke-width="${active ? 2.5 : 1.1}"></circle>
        <title>${esc(node.label)} (${fmtInt(node.recetas)} recetas)</title>
        <text x="${node.x}" y="${node.y + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${textFill}">${esc(String(node.type).charAt(0).toUpperCase())}</text>
      </g>
    `;
  }).join("");

  $("network-graph").innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="min-width:${W}px;display:block">${headings}${svgEdges}${svgNodes}</svg>`;

  $("network-graph").querySelectorAll(".network-node").forEach((nodeEl) => {
    nodeEl.addEventListener("click", () => {
      state.selectedNetworkNode = {
        type: nodeEl.dataset.nodeType,
        id: nodeEl.dataset.nodeId,
      };
      renderNetworkView();
    });
  });
}

function renderNetworkFocus(snapshot) {
  if (!state.selectedNetworkNode) {
    $("network-focus").innerHTML = `<div class="empty-state">Seleccione un nodo para analizar relaciones.</div>`;
    return;
  }
  const { type, id } = state.selectedNetworkNode;
  const label = getNodeLabel(snapshot, type, id);
  const edges = [
    ...rowsToObjects(snapshot.edges.medico_paciente).map((item) => ({ ...item, edgeType: "medico_paciente" })),
    ...rowsToObjects(snapshot.edges.paciente_producto).map((item) => ({ ...item, edgeType: "paciente_producto" })),
    ...rowsToObjects(snapshot.edges.medico_producto).map((item) => ({ ...item, edgeType: "medico_producto" })),
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
  }).sort((a, b) => Number(b.recetas || 0) - Number(a.recetas || 0)).slice(0, 30);

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

function renderNetworkMonthOptions() {
  const months = state.networkIndex?.months || [];
  $("network-month").innerHTML = months.map((item) => `<option value="${esc(item.mes)}">${esc(item.mes)}</option>`).join("");
  if (!state.selectedNetworkMonth && months.length) state.selectedNetworkMonth = months[0].mes;
  $("network-month").value = state.selectedNetworkMonth;
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
  const filtered = buildFilteredNetwork(snapshot);
  $("network-meta").textContent = `Mes ${snapshot.mes} · red filtrada`;
  renderNetworkMonthOptions();
  populateNetworkDatalists(snapshot);
  renderNetworkKpis(snapshot);
  renderNetworkGraph(snapshot, filtered);
  renderNetworkFocus(snapshot);
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

  $("network-month").addEventListener("change", () => {
    state.selectedNetworkMonth = $("network-month").value;
    state.selectedNetworkNode = null;
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
