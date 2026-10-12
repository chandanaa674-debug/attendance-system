/**
 * TechBots-SIT RFID Attendance System
 * Today's Attendance Page Controller
 */

const API_BASE = window.location.origin;

let recordsCache = [];
let sortColumn = "name";
let sortDirection = "asc";
let currentPage = 1;
let pageSize = 10;

document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initAuthHeader();
  initListeners();
  loadAttendanceToday();

  // Background refresh every 5 seconds
  setInterval(loadAttendanceToday, 5000);
});

function initClock() {
  const clockEl = document.getElementById("live-clock");
  if (!clockEl) return;
  function update() {
    clockEl.textContent = new Date().toLocaleTimeString();
  }
  update();
  setInterval(update, 1000);
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

function initListeners() {
  const searchInput = document.getElementById("attendance-search");
  if (searchInput) searchInput.addEventListener("input", () => { currentPage = 1; renderAttendanceTable(); });

  const statusFilter = document.getElementById("attendance-filter-status");
  if (statusFilter) statusFilter.addEventListener("change", () => { currentPage = 1; renderAttendanceTable(); });

  const deptFilter = document.getElementById("attendance-filter-dept");
  if (deptFilter) deptFilter.addEventListener("change", () => { currentPage = 1; renderAttendanceTable(); });

  const branchFilter = document.getElementById("attendance-filter-branch");
  if (branchFilter) branchFilter.addEventListener("change", () => { currentPage = 1; renderAttendanceTable(); });

  const pageSizeSelect = document.getElementById("attendance-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", (e) => {
      pageSize = e.target.value === "ALL" ? 999999 : parseInt(e.target.value, 10);
      currentPage = 1;
      renderAttendanceTable();
    });
  }

  const btnRefresh = document.getElementById("btn-refresh-attendance");
  if (btnRefresh) btnRefresh.addEventListener("click", loadAttendanceToday);

  // Column Sort Listeners
  document.querySelectorAll("#attendance-roster-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (sortColumn === col) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = col;
        sortDirection = "asc";
      }
      updateSortIndicators();
      renderAttendanceTable();
    });
  });

  // Dynamic Export Buttons
  const btnExportXlsx = document.getElementById("btn-export-today-xlsx");
  if (btnExportXlsx) {
    btnExportXlsx.addEventListener("click", () => triggerAttendanceExport("xlsx"));
  }

  const btnExportCsv = document.getElementById("btn-export-today-csv");
  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => triggerAttendanceExport("csv"));
  }
}

function updateSortIndicators() {
  document.querySelectorAll("#attendance-roster-table th.sortable").forEach(th => {
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

function triggerAttendanceExport(format) {
  const q = (document.getElementById("attendance-search")?.value || "").trim();
  const status = document.getElementById("attendance-filter-status")?.value || "ALL";
  const dept = document.getElementById("attendance-filter-dept")?.value || "ALL";
  const branch = document.getElementById("attendance-filter-branch")?.value || "ALL";
  const todayStr = new Date().toISOString().split("T")[0];

  const params = new URLSearchParams();
  params.append("format", format);
  params.append("date", todayStr);
  if (status && status !== "ALL") params.append("status", status);
  if (dept && dept !== "ALL") params.append("department", dept);
  if (branch && branch !== "ALL") params.append("branch", branch);
  if (q) params.append("q", q);

  window.location.href = `${API_BASE}/api/attendance/export?${params.toString()}`;
}

function populateAttendanceFilters(records) {
  const deptSelect = document.getElementById("attendance-filter-dept");
  if (deptSelect) {
    const curVal = deptSelect.value;
    const depts = new Set();
    records.forEach(r => { if (r.department) depts.add(r.department.toUpperCase()); });
    deptSelect.innerHTML = '<option value="ALL">All Departments</option>';
    Array.from(depts).sort().forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      deptSelect.appendChild(opt);
    });
    if (depts.has(curVal)) deptSelect.value = curVal;
  }

  const branchSelect = document.getElementById("attendance-filter-branch");
  if (branchSelect) {
    const curVal = branchSelect.value;
    const branches = new Set();
    records.forEach(r => { if (r.branch) branches.add(r.branch); });
    branchSelect.innerHTML = '<option value="ALL">All Branches</option>';
    Array.from(branches).sort().forEach(b => {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      branchSelect.appendChild(opt);
    });
    if (branches.has(curVal)) branchSelect.value = curVal;
  }
}

async function loadAttendanceToday() {
  const tbody = document.getElementById("attendance-session-tbody");

  try {
    const res = await fetch(`${API_BASE}/api/attendance/today`);
    const data = await res.json();

    if (data.success && Array.isArray(data.records)) {
      recordsCache = data.records;

      const dateEl = document.getElementById("attendance-session-date");
      if (dateEl) {
        const todayStr = data.date || new Date().toISOString().split("T")[0];
        dateEl.textContent = `Session Date: ${todayStr} • TechBots Live Access Log (Asia/Kolkata)`;
      }

      // Update KPIs
      const total = recordsCache.length;
      const present = recordsCache.filter(r => r.status === "Present" || r.status === "PRESENT").length;
      const exited = recordsCache.filter(r => r.status === "Left" || r.status === "EXITED").length;
      const notScanned = total - (present + exited);

      document.getElementById("card-total").textContent = total;
      document.getElementById("card-present").textContent = present;
      document.getElementById("card-exited").textContent = exited;
      document.getElementById("card-not-scanned").textContent = notScanned;

      populateAttendanceFilters(recordsCache);
      renderAttendanceTable();
    }
  } catch (err) {
    if (tbody && recordsCache.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
            Could not communicate with server. Please verify Flask backend is running.
          </td>
        </tr>
      `;
    }
  }
}

function renderAttendanceTable() {
  const tbody = document.getElementById("attendance-session-tbody");
  if (!tbody) return;

  const q = (document.getElementById("attendance-search")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("attendance-filter-status")?.value || "ALL";
  const deptFilter = (document.getElementById("attendance-filter-dept")?.value || "ALL").toUpperCase();
  const branchFilter = (document.getElementById("attendance-filter-branch")?.value || "ALL").toLowerCase();

  let filtered = recordsCache.filter(r => {
    const stat = r.status || "Not Marked";
    if (statusFilter !== "ALL") {
      if (statusFilter === "Present" && !(stat === "Present" || stat === "PRESENT")) return false;
      if (statusFilter === "Left" && !(stat === "Left" || stat === "EXITED")) return false;
      if (statusFilter === "Not Marked" && !(stat === "Not Marked" || stat === "NOT SCANNED")) return false;
    }
    if (deptFilter !== "ALL" && (r.department || "").toUpperCase() !== deptFilter) return false;
    if (branchFilter !== "ALL" && (r.branch || "").toLowerCase() !== branchFilter) return false;
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
      let valA = "";
      let valB = "";

      if (sortColumn === "last_scan") {
        valA = a.out_time || a.in_time || "";
        valB = b.out_time || b.in_time || "";
      } else {
        valA = (a[sortColumn] || "").toString().toLowerCase();
        valB = (b[sortColumn] || "").toString().toLowerCase();
      }

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
  const infoEl = document.getElementById("attendance-pagination-info");
  if (infoEl) {
    infoEl.textContent = totalRecords === 0
      ? "Showing 0 of 0 records"
      : `Showing ${startIndex + 1} to ${endIndex} of ${totalRecords} records`;
  }

  renderAttendancePaginationControls(totalPages);

  if (pagedRecords.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 2.5rem 1rem;">
          <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>
          No matching records found for today's session.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pagedRecords.map(r => {
    let pillClass = "not-marked";
    let iconClass = "fa-regular fa-clock";
    const statusVal = r.status || "Not Marked";

    if (statusVal === "Present" || statusVal === "PRESENT") {
      pillClass = "present";
      iconClass = "fa-solid fa-door-open";
    } else if (statusVal === "Left" || statusVal === "EXITED") {
      pillClass = "left";
      iconClass = "fa-solid fa-door-closed";
    }

    const lastScanTime = r.out_time || r.in_time || "--";

    return `
      <tr>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><span class="dept-badge">${escapeHtml(r.department || "General")}</span></td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(r.branch || "-")}</td>
        <td style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(r.usn)}</td>
        <td style="font-family: var(--font-mono); font-size: 0.84rem; color: var(--primary); font-weight: 600;">${escapeHtml(lastScanTime)}</td>
        <td style="font-family: var(--font-mono); font-size: 0.84rem; color: #065f46;">${escapeHtml(r.in_time || "--")}</td>
        <td style="font-family: var(--font-mono); font-size: 0.84rem; color: #92400e;">${escapeHtml(r.out_time || "--")}</td>
        <td>
          <span class="status-pill ${pillClass}">
            <i class="${iconClass}"></i> ${escapeHtml(statusVal === "EXITED" ? "Left" : statusVal)}
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

function renderAttendancePaginationControls(totalPages) {
  const container = document.getElementById("attendance-pagination-controls");
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <button class="btn-page" id="btn-att-prev" ${currentPage === 1 ? "disabled" : ""} title="Previous Page">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    html += `
      <button class="btn-page ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>
    `;
  }

  html += `
    <button class="btn-page" id="btn-att-next" ${currentPage === totalPages ? "disabled" : ""} title="Next Page">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  container.innerHTML = html;

  const btnPrev = document.getElementById("btn-att-prev");
  if (btnPrev) btnPrev.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderAttendanceTable();
    }
  });

  const btnNext = document.getElementById("btn-att-next");
  if (btnNext) btnNext.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderAttendanceTable();
    }
  });

  container.querySelectorAll(".btn-page[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentPage = parseInt(btn.getAttribute("data-page"), 10);
      renderAttendanceTable();
    });
  });
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

