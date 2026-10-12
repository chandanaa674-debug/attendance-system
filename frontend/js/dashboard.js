/**
 * TechBots-SIT RFID Attendance System
 * Dashboard Controller & Live Simulation Handler
 */

const API_BASE = window.location.origin;

let attendanceCache = [];
let isManualMode = false;
let isOffline = false;

document.addEventListener("DOMContentLoaded", () => {
  initLiveClock();
  initAuthHeader();
  initSimulatorControls();
  initTableFilters();
  loadMembersDropdown();
  loadDashboardData();

  // Background polling every 4 seconds for live ESP32 / multi-screen sync
  setInterval(loadDashboardData, 4000);
});

/* ==========================================================================
   Clock & Header
   ========================================================================== */
function initLiveClock() {
  const clockEl = document.getElementById("live-clock");
  const dateEl = document.getElementById("current-date-display");

  function update() {
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString();
    }
    if (dateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      dateEl.textContent = `${now.toLocaleDateString(undefined, options)} • Live Session (Mangaluru, India)`;
    }
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

function setOfflineState(offline) {
  isOffline = offline;
  const banner = document.getElementById("offline-banner");
  const dot = document.querySelector(".status-dot");
  const text = document.getElementById("system-status-text");

  if (banner) banner.style.display = offline ? "flex" : "none";
  if (dot) dot.style.backgroundColor = offline ? "#ef4444" : "#10b981";
  if (text) text.textContent = offline ? "Server Offline" : "System Active";
}

/* ==========================================================================
   Load Members for Simulator Dropdown
   ========================================================================== */
async function loadMembersDropdown() {
  const selectEl = document.getElementById("member-select");
  if (!selectEl) return;

  try {
    const res = await fetch(`${API_BASE}/api/members`);
    const data = await res.json();

    if (data.success && Array.isArray(data.members)) {
      selectEl.innerHTML = '<option value="">-- Choose Member to Tap Card --</option>';

      data.members.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.rfid_uid || m.usn;
        const tagText = m.rfid_uid ? `Tag: ${m.rfid_uid}` : `USN: ${m.usn}`;
        opt.textContent = `${m.name} (${m.department}) • ${tagText}`;
        selectEl.appendChild(opt);
      });
    }
  } catch (err) {
    console.warn("Failed to load members for simulator dropdown:", err);
  }
}

/* ==========================================================================
   Simulator Controls & Card Tap Handler
   ========================================================================== */
function initSimulatorControls() {
  const btnToggleManual = document.getElementById("btn-toggle-manual");
  const btnToggleDropdown = document.getElementById("btn-toggle-dropdown");
  const dropdownGroup = document.getElementById("dropdown-group");
  const manualGroup = document.getElementById("manual-group");
  const btnScan = document.getElementById("btn-scan-card");

  if (btnToggleManual && btnToggleDropdown) {
    btnToggleManual.addEventListener("click", () => {
      isManualMode = true;
      dropdownGroup.style.display = "none";
      manualGroup.style.display = "block";
      document.getElementById("manual-identifier").focus();
    });

    btnToggleDropdown.addEventListener("click", () => {
      isManualMode = false;
      manualGroup.style.display = "none";
      dropdownGroup.style.display = "block";
    });
  }

  if (btnScan) {
    btnScan.addEventListener("click", handleCardTap);
  }

  const manualInput = document.getElementById("manual-identifier");
  if (manualInput) {
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCardTap();
      }
    });
  }
}

async function handleCardTap() {
  let identifier = "";

  if (isManualMode) {
    const manualInput = document.getElementById("manual-identifier");
    identifier = manualInput.value.trim();
  } else {
    const selectEl = document.getElementById("member-select");
    identifier = selectEl.value;
  }

  if (!identifier) {
    showScanAlert("Please select a club member or enter a card UID / USN to tap.", "warning");
    return;
  }

  const btnScan = document.getElementById("btn-scan-card");
  btnScan.disabled = true;
  btnScan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> READING RFID...';

  try {
    const headers = {
      "Content-Type": "application/json",
      "X-Client-Source": "TechBots-Dashboard-Simulator"
    };

    const token = localStorage.getItem("techbots_admin_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/api/attendance/scan`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ identifier: identifier })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      if (data.action === "ENTRY") {
        showScanAlert(`ENTRY MARKED: Welcome, ${data.name}! In-Time: ${data.time}`, "success");
      } else if (data.action === "EXIT") {
        showScanAlert(`EXIT MARKED: Goodbye, ${data.name}! Out-Time: ${data.time}`, "exited");
      } else {
        showScanAlert(data.message || "Attendance recorded.", "success");
      }
      playScanChirp(data.action === "EXIT" ? 2 : 1);
    } else if (res.status === 404 || data.unknown_card) {
      showScanAlert(`Unknown RFID Card (${identifier}). Not associated with any member.`, "danger");
      playScanChirp(3);
    } else if (res.status === 429 || data.cooldown) {
      showScanAlert(data.message || "Card scanned too quickly. Debounce cooldown active.", "warning");
      playScanChirp(3);
    } else {
      showScanAlert(data.message || data.error || "Attendance already completed for today.", "warning");
    }

    // Immediately refresh dashboard metrics
    await loadDashboardData();

  } catch (err) {
    showScanAlert("Could not reach backend API. Server might be down.", "danger");
    setOfflineState(true);
  } finally {
    btnScan.disabled = false;
    btnScan.innerHTML = '<i class="fa-solid fa-wifi"></i> TAP RFID CARD';
  }
}

function showScanAlert(message, type) {
  const alertBox = document.getElementById("scan-alert-box");
  const icon = document.getElementById("scan-alert-icon");
  const text = document.getElementById("scan-alert-text");

  if (!alertBox || !text) return;

  alertBox.className = "scan-notification-bar";
  alertBox.classList.add(`alert-${type}`);

  if (icon) {
    icon.className = "fa-solid";
    if (type === "success") icon.classList.add("fa-circle-check");
    else if (type === "exited") icon.classList.add("fa-door-closed");
    else if (type === "warning") icon.classList.add("fa-triangle-exclamation");
    else icon.classList.add("fa-circle-xmark");
  }

  text.textContent = message;
}

function playScanChirp(beeps = 1) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    for (let i = 0; i < beeps; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(beeps === 3 ? 350 : 880, ctx.currentTime + (i * 0.12));
      gain.gain.setValueAtTime(0.08, ctx.currentTime + (i * 0.12));
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (i * 0.12) + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + (i * 0.12));
      osc.stop(ctx.currentTime + (i * 0.12) + 0.09);
    }
  } catch (e) {
    // Audio optional
  }
}

/* ==========================================================================
   Dashboard Data Fetching & Table Rendering
   ========================================================================== */
async function loadDashboardData() {
  try {
    const res = await fetch(`${API_BASE}/api/dashboard`);
    const data = await res.json();

    if (data.success) {
      setOfflineState(false);
      updateDashboardKPIs(data);
      updateLatestScanCard(data.latest_scan);
      attendanceCache = data.today_attendance || [];
      populateFilters(attendanceCache);
      renderAttendanceTable();

    }
  } catch (err) {
    setOfflineState(true);
  }
}

function updateDashboardKPIs(data) {
  const elTotal = document.getElementById("stat-total");
  const elPresent = document.getElementById("stat-present");
  const elExited = document.getElementById("stat-exited");
  const elTodayRecords = document.getElementById("stat-today-records");

  if (elTotal) elTotal.textContent = data.total_members ?? 0;
  if (elPresent) elPresent.textContent = data.present_count ?? 0;
  if (elExited) elExited.textContent = data.left_count ?? 0;
  if (elTodayRecords) elTodayRecords.textContent = data.today_records_count ?? 0;
}

function updateLatestScanCard(scan) {
  const container = document.getElementById("latest-scan-container");
  if (!container) return;

  if (!scan || !scan.name) {
    container.innerHTML = `
      <div class="activity-empty-state">
        <i class="fa-regular fa-id-badge"></i>
        <p style="font-weight: 500;">No scans yet today</p>
        <span style="font-size: 0.8rem; color: var(--text-dim);">Tap an RFID card to record attendance</span>
      </div>
    `;
    return;
  }

  const isEntry = scan.action === "ENTRY";
  const badgeClass = isEntry ? "present" : "exited";
  const iconClass = isEntry ? "fa-door-open" : "fa-door-closed";
  const actionLabel = isEntry ? "ENTRY (PRESENT)" : "EXIT (LEFT)";

  container.innerHTML = `
    <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.75rem;">
      <div>
        <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">${escapeHtml(scan.name)}</div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.15rem;">
          <span style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(scan.usn)}</span> •
          <span>${escapeHtml(scan.department)}</span>
        </div>
      </div>
      <span class="status-pill ${badgeClass}">
        <i class="fa-solid ${iconClass}"></i> ${actionLabel}
      </span>
    </div>
    <div style="font-size: 0.85rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem; background: #f8fafc; padding: 0.5rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border);">
      <i class="fa-regular fa-clock" style="color: var(--primary);"></i>
      <span>Recorded at: <strong>${escapeHtml(scan.time)}</strong></span>
    </div>
  `;
}

let sortColumn = "name";
let sortDirection = "asc";
let currentPage = 1;
let pageSize = 10;
let selectedDate = "";

function populateFilters(records) {
  // Department filter
  const deptSelect = document.getElementById("dept-filter");
  if (deptSelect) {
    const currentVal = deptSelect.value;
    const depts = new Set();
    records.forEach(r => {
      if (r.department) depts.add(r.department.toUpperCase());
    });
    deptSelect.innerHTML = '<option value="ALL">All Departments</option>';
    Array.from(depts).sort().forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      deptSelect.appendChild(opt);
    });
    if (depts.has(currentVal)) deptSelect.value = currentVal;
  }

  // Branch filter
  const branchSelect = document.getElementById("branch-filter");
  if (branchSelect) {
    const currentVal = branchSelect.value;
    const branches = new Set();
    records.forEach(r => {
      if (r.branch) branches.add(r.branch);
    });
    branchSelect.innerHTML = '<option value="ALL">All Branches</option>';
    Array.from(branches).sort().forEach(b => {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      branchSelect.appendChild(opt);
    });
    if (branches.has(currentVal)) branchSelect.value = currentVal;
  }
}

function initTableFilters() {
  const searchInput = document.getElementById("table-search");
  if (searchInput) searchInput.addEventListener("input", () => { currentPage = 1; renderAttendanceTable(); });

  const statusFilter = document.getElementById("status-filter");
  if (statusFilter) statusFilter.addEventListener("change", () => { currentPage = 1; renderAttendanceTable(); });

  const deptFilter = document.getElementById("dept-filter");
  if (deptFilter) deptFilter.addEventListener("change", () => { currentPage = 1; renderAttendanceTable(); });

  const branchFilter = document.getElementById("branch-filter");
  if (branchFilter) branchFilter.addEventListener("change", () => { currentPage = 1; renderAttendanceTable(); });

  const dateInput = document.getElementById("table-date");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.value = today;
    selectedDate = today;
    dateInput.addEventListener("change", (e) => {
      selectedDate = e.target.value;
      currentPage = 1;
      loadAttendanceForDate(selectedDate);
    });
  }

  const pageSizeSelect = document.getElementById("table-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", (e) => {
      pageSize = e.target.value === "ALL" ? 999999 : parseInt(e.target.value, 10);
      currentPage = 1;
      renderAttendanceTable();
    });
  }

  const refreshBtn = document.getElementById("btn-manual-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", loadDashboardData);

  // Column Sort Listeners
  document.querySelectorAll("#dashboard-roster-table th.sortable").forEach(th => {
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

  // Dynamic Export Buttons (Excel & CSV)
  const btnExportXlsx = document.getElementById("btn-export-today");
  if (btnExportXlsx) {
    btnExportXlsx.addEventListener("click", () => triggerDashboardExport("xlsx"));
  }

  const btnExportCsv = document.getElementById("btn-export-csv-today");
  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => triggerDashboardExport("csv"));
  }
}

function updateSortIndicators() {
  document.querySelectorAll("#dashboard-roster-table th.sortable").forEach(th => {
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

function triggerDashboardExport(format) {
  const q = (document.getElementById("table-search")?.value || "").trim();
  const status = document.getElementById("status-filter")?.value || "ALL";
  const dept = document.getElementById("dept-filter")?.value || "ALL";
  const branch = document.getElementById("branch-filter")?.value || "ALL";
  const date = document.getElementById("table-date")?.value || "";

  const params = new URLSearchParams();
  params.append("format", format);
  if (date) params.append("date", date);
  if (status && status !== "ALL") params.append("status", status);
  if (dept && dept !== "ALL") params.append("department", dept);
  if (branch && branch !== "ALL") params.append("branch", branch);
  if (q) params.append("q", q);

  window.location.href = `${API_BASE}/api/attendance/export?${params.toString()}`;
}

async function loadAttendanceForDate(dateStr) {
  if (!dateStr) {
    await loadDashboardData();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/attendance/history?date=${encodeURIComponent(dateStr)}`);
    const data = await res.json();
    if (data.success) {
      attendanceCache = data.records || [];
      populateFilters(attendanceCache);
      renderAttendanceTable();
    }
  } catch (err) {
    console.warn("Failed to fetch records for date:", dateStr);
  }
}

function renderAttendanceTable() {
  const tbody = document.getElementById("attendance-table-body");
  if (!tbody) return;

  const q = (document.getElementById("table-search")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("status-filter")?.value || "ALL";
  const deptFilter = (document.getElementById("dept-filter")?.value || "ALL").toUpperCase();
  const branchFilter = (document.getElementById("branch-filter")?.value || "ALL").toLowerCase();

  let filtered = attendanceCache.filter(r => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
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
  const infoEl = document.getElementById("table-pagination-info");
  if (infoEl) {
    infoEl.textContent = totalRecords === 0
      ? "Showing 0 of 0 records"
      : `Showing ${startIndex + 1} to ${endIndex} of ${totalRecords} records`;
  }

  renderPaginationControls(totalPages);

  if (pagedRecords.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-dim); padding: 2.5rem 1rem;">
          <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>
          No attendance records match your search or filter criteria.
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
            <i class="${iconClass}"></i> ${escapeHtml(statusVal)}
          </span>
        </td>
        <td>
          <button class="btn-secondary btn-quick-tap" data-usn="${escapeHtml(r.usn)}" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;">
            <i class="fa-solid fa-wifi"></i> Tap Card
          </button>
        </td>
      </tr>
    `;
  }).join("");

  // Attach quick tap listeners
  document.querySelectorAll(".btn-quick-tap").forEach(btn => {
    btn.addEventListener("click", () => {
      const usn = btn.getAttribute("data-usn");
      if (usn) {
        document.getElementById("manual-identifier").value = usn;
        isManualMode = true;
        document.getElementById("dropdown-group").style.display = "none";
        document.getElementById("manual-group").style.display = "block";
        handleCardTap();
      }
    });
  });
}

function renderPaginationControls(totalPages) {
  const container = document.getElementById("dashboard-pagination-controls");
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <button class="btn-page" id="btn-page-prev" ${currentPage === 1 ? "disabled" : ""} title="Previous Page">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    html += `
      <button class="btn-page ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>
    `;
  }

  html += `
    <button class="btn-page" id="btn-page-next" ${currentPage === totalPages ? "disabled" : ""} title="Next Page">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  container.innerHTML = html;

  const btnPrev = document.getElementById("btn-page-prev");
  if (btnPrev) btnPrev.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderAttendanceTable();
    }
  });

  const btnNext = document.getElementById("btn-page-next");
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

