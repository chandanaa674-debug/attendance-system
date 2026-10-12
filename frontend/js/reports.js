/**
 * TechBots-SIT RFID Attendance System
 * Reports Controller & Export Handler
 */

const API_BASE = window.location.origin;

let cachedRecords = [];
let availableDepts = new Set();
let availableBranches = new Set();

let sortColumn = "date";
let sortDirection = "desc";
let currentPage = 1;
let pageSize = 10;

document.addEventListener("DOMContentLoaded", () => {
  initDateSelectors();
  initAuthHeader();
  bindReportEvents();
  runReport();
});

function initDateSelectors() {
  const today = new Date().toISOString().split("T")[0];
  const startEl = document.getElementById("report-start-date");
  const endEl = document.getElementById("report-end-date");

  if (startEl && !startEl.value) startEl.value = today;
  if (endEl && !endEl.value) endEl.value = today;
}

function initAuthHeader() {
  const slot = document.getElementById("auth-header-slot");
  if (!slot) return;
  const token = localStorage.getItem("techbots_admin_token");
  if (token) {
    slot.innerHTML = `
      <span class="admin-logged-in-pill"><i class="fa-solid fa-user-shield"></i> Admin</span>
      <button id="btn-header-logout" class="btn-header-auth" style="margin-left: 0.4rem;">
        <i class="fa-solid fa-right-from-bracket"></i> Logout
      </button>
    `;
    const logoutBtn = document.getElementById("btn-header-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("techbots_admin_token");
        window.location.reload();
      });
    }
  }
}

function bindReportEvents() {
  const btnRun = document.getElementById("btn-run-report");
  if (btnRun) btnRun.addEventListener("click", () => { currentPage = 1; runReport(); });

  const btnRefresh = document.getElementById("btn-refresh-report");
  if (btnRefresh) btnRefresh.addEventListener("click", () => { currentPage = 1; runReport(); });

  const btnToday = document.getElementById("btn-quick-today");
  if (btnToday) {
    btnToday.addEventListener("click", () => {
      const today = new Date().toISOString().split("T")[0];
      document.getElementById("report-start-date").value = today;
      document.getElementById("report-end-date").value = today;
      currentPage = 1;
      runReport();
    });
  }

  const btnAll = document.getElementById("btn-quick-all");
  if (btnAll) {
    btnAll.addEventListener("click", () => {
      document.getElementById("report-start-date").value = "";
      document.getElementById("report-end-date").value = "";
      currentPage = 1;
      runReport();
    });
  }

  // Filter events
  const searchInput = document.getElementById("report-search");
  if (searchInput) searchInput.addEventListener("input", () => { currentPage = 1; renderTable(); });

  const deptFilter = document.getElementById("report-dept-filter");
  if (deptFilter) deptFilter.addEventListener("change", () => { currentPage = 1; renderTable(); });

  const branchFilter = document.getElementById("report-branch-filter");
  if (branchFilter) branchFilter.addEventListener("change", () => { currentPage = 1; renderTable(); });

  const statFilter = document.getElementById("report-status-filter");
  if (statFilter) statFilter.addEventListener("change", () => { currentPage = 1; renderTable(); });

  const pageSizeSelect = document.getElementById("reports-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", (e) => {
      pageSize = e.target.value === "ALL" ? 999999 : parseInt(e.target.value, 10);
      currentPage = 1;
      renderTable();
    });
  }

  // Column Sort Listeners
  document.querySelectorAll("#reports-roster-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (sortColumn === col) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = col;
        sortDirection = "asc";
      }
      updateSortIndicators();
      renderTable();
    });
  });

  // Export buttons
  const btnXlsx = document.getElementById("btn-export-xlsx");
  if (btnXlsx) {
    btnXlsx.addEventListener("click", () => triggerExport("xlsx"));
  }

  const btnCsv = document.getElementById("btn-export-csv");
  if (btnCsv) {
    btnCsv.addEventListener("click", () => triggerExport("csv"));
  }
}

function updateSortIndicators() {
  document.querySelectorAll("#reports-roster-table th.sortable").forEach(th => {
    const col = th.getAttribute("data-sort");
    const icon = th.querySelector("i");
    th.classList.remove("sorted-asc", "sorted-desc");
    if (icon) icon.className = "fa-solid fa-sort";

    if (col === sortColumn) {
      th.classList.add(sortDirection === "asc" ? "sorted-asc" : "sorted-desc");
      if (icon) icon.className = `fa-solid ${sortDirection === "asc" ? "fa-sort-up" : "fa-sort-down"}`;
    }
  });
}

async function runReport() {
  const start = document.getElementById("report-start-date").value;
  const end = document.getElementById("report-end-date").value;
  const tbody = document.getElementById("report-table-body");

  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 2rem;">
        <i class="fa-solid fa-spinner fa-spin"></i> Generating attendance report...
      </td>
    </tr>
  `;

  try {
    const params = new URLSearchParams();
    if (start) params.append("start_date", start);
    if (end) params.append("end_date", end);

    const res = await fetch(`${API_BASE}/api/reports/attendance?${params.toString()}`);
    const data = await res.json();

    if (data.success) {
      cachedRecords = data.records || [];

      // Update KPI cards
      document.getElementById("rep-stat-total").textContent = data.total_records || cachedRecords.length;
      document.getElementById("rep-stat-present").textContent = data.present_count || 0;
      document.getElementById("rep-stat-left").textContent = data.left_count || 0;

      const totalActive = (data.present_count || 0) + (data.left_count || 0);
      const totalRoster = data.total_records || cachedRecords.length;
      const rate = totalRoster > 0 ? Math.round((totalActive / totalRoster) * 100) : 0;
      document.getElementById("rep-stat-rate").textContent = `${rate}%`;

      const spanText = start && end ? (start === end ? start : `${start} to ${end}`) : "All Dates";
      document.getElementById("rep-date-span").textContent = spanText;

      // Render Department Breakdown
      renderDepartmentBreakdown(data.department_breakdown || {});

      // Populate Filters
      populateReportFilters(cachedRecords);

      // Render Table
      renderTable();
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
            Failed to generate report: ${data.error || "Unknown error"}
          </td>
        </tr>
      `;
    }
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
          Could not communicate with server. Please check backend connection.
        </td>
      </tr>
    `;
  }
}

function renderDepartmentBreakdown(deptStats) {
  const container = document.getElementById("dept-cards-grid");
  if (!container) return;

  const depts = Object.keys(deptStats);
  if (depts.length === 0) {
    container.innerHTML = `<div style="color: var(--text-dim); font-size: 0.85rem;">No departmental data for this period.</div>`;
    return;
  }

  container.innerHTML = depts.map(d => {
    const stat = deptStats[d];
    return `
      <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
        <div style="font-weight: 700; color: var(--primary); font-size: 0.92rem; margin-bottom: 0.4rem;">${escapeHtml(d)}</div>
        <div style="display: flex; gap: 0.75rem; font-size: 0.8rem;">
          <div>Present: <strong style="color: #065f46;">${stat.present}</strong></div>
          <div>Left: <strong style="color: #92400e;">${stat.left}</strong></div>
          <div>Total: <strong>${stat.total}</strong></div>
        </div>
      </div>
    `;
  }).join("");
}

function populateReportFilters(records) {
  const deptSelect = document.getElementById("report-dept-filter");
  if (deptSelect) {
    const curVal = deptSelect.value;
    availableDepts = new Set();
    records.forEach(r => { if (r.department) availableDepts.add(r.department.toUpperCase()); });
    deptSelect.innerHTML = '<option value="ALL">All Departments</option>';
    Array.from(availableDepts).sort().forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      deptSelect.appendChild(opt);
    });
    if (availableDepts.has(curVal)) deptSelect.value = curVal;
  }

  const branchSelect = document.getElementById("report-branch-filter");
  if (branchSelect) {
    const curVal = branchSelect.value;
    availableBranches = new Set();
    records.forEach(r => { if (r.branch) availableBranches.add(r.branch); });
    branchSelect.innerHTML = '<option value="ALL">All Branches</option>';
    Array.from(availableBranches).sort().forEach(b => {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      branchSelect.appendChild(opt);
    });
    if (availableBranches.has(curVal)) branchSelect.value = curVal;
  }
}

function renderTable() {
  const tbody = document.getElementById("report-table-body");
  if (!tbody) return;

  const q = (document.getElementById("report-search").value || "").trim().toLowerCase();
  const dept = (document.getElementById("report-dept-filter").value || "ALL").toUpperCase();
  const branch = (document.getElementById("report-branch-filter")?.value || "ALL").toLowerCase();
  const stat = document.getElementById("report-status-filter").value || "ALL";

  let filtered = cachedRecords.filter(r => {
    if (dept !== "ALL" && (r.department || "").toUpperCase() !== dept) return false;
    if (branch !== "ALL" && (r.branch || "").toLowerCase() !== branch) return false;
    if (stat !== "ALL" && r.status !== stat) return false;
    if (q) {
      const match = (r.name || "").toLowerCase().includes(q) ||
                    (r.usn || "").toLowerCase().includes(q) ||
                    (r.department || "").toLowerCase().includes(q) ||
                    (r.branch || "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Sorting
  if (sortColumn) {
    filtered.sort((a, b) => {
      let valA = (a[sortColumn] || "").toString().toLowerCase();
      let valB = (b[sortColumn] || "").toString().toLowerCase();
      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }

  const totalRecords = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);
  const pagedRecords = filtered.slice(startIndex, endIndex);

  // Update Pagination Info
  const infoEl = document.getElementById("reports-pagination-info");
  if (infoEl) {
    infoEl.textContent = totalRecords === 0
      ? "Showing 0 of 0 records"
      : `Showing ${startIndex + 1} to ${endIndex} of ${totalRecords} records`;
  }

  renderReportsPaginationControls(totalPages);

  if (pagedRecords.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 2.5rem 1rem;">
          <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>
          No matching records found for the applied filters.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pagedRecords.map(r => {
    let pillClass = "not-marked";
    let iconClass = "fa-regular fa-clock";
    const statusVal = r.status || "Not Marked";

    if (statusVal === "Present") {
      pillClass = "present";
      iconClass = "fa-solid fa-door-open";
    } else if (statusVal === "Left") {
      pillClass = "left";
      iconClass = "fa-solid fa-door-closed";
    }

    return `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 0.82rem;">${escapeHtml(r.date || "-")}</td>
        <td><strong>${escapeHtml(r.name || "-")}</strong></td>
        <td><span class="dept-badge">${escapeHtml(r.department || "General")}</span></td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(r.branch || "-")}</td>
        <td style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(r.usn || "-")}</td>
        <td style="font-family: var(--font-mono); font-size: 0.84rem; color: #065f46;">${escapeHtml(r.in_time || "--")}</td>
        <td style="font-family: var(--font-mono); font-size: 0.84rem; color: #92400e;">${escapeHtml(r.out_time || "--")}</td>
        <td>
          <span class="status-pill ${pillClass}">
            <i class="${iconClass}"></i> ${escapeHtml(statusVal)}
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

function renderReportsPaginationControls(totalPages) {
  const container = document.getElementById("reports-pagination-controls");
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <button class="btn-page" id="btn-rep-prev" ${currentPage === 1 ? "disabled" : ""} title="Previous Page">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    html += `
      <button class="btn-page ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>
    `;
  }

  html += `
    <button class="btn-page" id="btn-rep-next" ${currentPage === totalPages ? "disabled" : ""} title="Next Page">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  container.innerHTML = html;

  const btnPrev = document.getElementById("btn-rep-prev");
  if (btnPrev) btnPrev.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  const btnNext = document.getElementById("btn-rep-next");
  if (btnNext) btnNext.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });

  container.querySelectorAll(".btn-page[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentPage = parseInt(btn.getAttribute("data-page"), 10);
      renderTable();
    });
  });
}

function triggerExport(format) {
  const start = document.getElementById("report-start-date").value;
  const end = document.getElementById("report-end-date").value;
  const dept = document.getElementById("report-dept-filter").value;
  const branch = document.getElementById("report-branch-filter")?.value;
  const stat = document.getElementById("report-status-filter").value;
  const q = document.getElementById("report-search").value;

  const params = new URLSearchParams();
  params.append("format", format);
  if (start) params.append("start_date", start);
  if (end) params.append("end_date", end);
  if (dept && dept !== "ALL") params.append("department", dept);
  if (branch && branch !== "ALL") params.append("branch", branch);
  if (stat && stat !== "ALL") params.append("status", stat);
  if (q) params.append("q", q);

  window.location.href = `${API_BASE}/api/attendance/export?${params.toString()}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

