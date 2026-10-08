/**
 * SRINIVAS INSTITUTE OF TECHNOLOGY | TechBots RFID Attendance System
 * Dashboard Controller & Simulation Handler
 */

const API_BASE = window.location.origin.includes("5000") ? window.location.origin : "http://127.0.0.1:5000";

let attendanceCache = [];
let isManualMode = false;

document.addEventListener("DOMContentLoaded", () => {
  initLiveClock();
  initSimulatorControls();
  initTableFilters();
  loadMembersDropdown();
  loadDashboardData();

  // Background polling every 5 seconds for live multi-client/ESP32 sync
  setInterval(loadDashboardData, 5000);
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
      dateEl.textContent = `${now.toLocaleDateString(undefined, options)} • Live Session`;
    }
  }

  update();
  setInterval(update, 1000);
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

      data.members.forEach(member => {
        const opt = document.createElement("option");
        opt.value = member.usn;
        opt.textContent = `${member.name} (${member.department}) — USN: ${member.usn}`;
        selectEl.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Failed to load members for dropdown:", err);
  }
}

/* ==========================================================================
   Simulator Controls & Actions
   ========================================================================== */
function initSimulatorControls() {
  const btnScan = document.getElementById("btn-scan-card");
  const btnToggleManual = document.getElementById("btn-toggle-manual");
  const btnToggleDropdown = document.getElementById("btn-toggle-dropdown");
  const dropdownGroup = document.getElementById("dropdown-group");
  const manualGroup = document.getElementById("manual-group");
  const btnRefresh = document.getElementById("btn-manual-refresh");

  if (btnToggleManual) {
    btnToggleManual.addEventListener("click", () => {
      isManualMode = true;
      dropdownGroup.style.display = "none";
      manualGroup.style.display = "flex";
      document.getElementById("manual-identifier")?.focus();
    });
  }

  if (btnToggleDropdown) {
    btnToggleDropdown.addEventListener("click", () => {
      isManualMode = false;
      manualGroup.style.display = "none";
      dropdownGroup.style.display = "flex";
    });
  }

  if (btnScan) {
    btnScan.addEventListener("click", () => {
      let identifier = "";
      if (isManualMode) {
        identifier = document.getElementById("manual-identifier")?.value.trim();
      } else {
        identifier = document.getElementById("member-select")?.value.trim();
      }

      if (!identifier) {
        showScanAlert("warning", "Please select a member or enter a USN first.");
        return;
      }

      executeScan(identifier);
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      loadDashboardData();
      showScanAlert("success", "Dashboard refreshed with latest data.");
    });
  }
}

/* ==========================================================================
   Execute RFID Scan API Call
   ========================================================================== */
async function executeScan(identifier) {
  const btnScan = document.getElementById("btn-scan-card");
  if (btnScan) {
    btnScan.disabled = true;
    btnScan.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing Scan...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/rfid/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: identifier })
    });

    const result = await res.json();

    if (result.success) {
      if (result.action === "ENTRY") {
        showScanAlert(
          "success",
          `ENTRY RECORDED: ${result.name} (${result.department}) marked PRESENT at ${result.time}`
        );
      } else if (result.action === "EXIT") {
        showScanAlert(
          "warning",
          `EXIT RECORDED: ${result.name} (${result.department}) marked EXITED at ${result.time}`
        );
      }
    } else {
      if (result.action === "COMPLETED" || result.message.includes("completed")) {
        showScanAlert(
          "warning",
          `${result.message} (${result.name || identifier})`
        );
      } else {
        showScanAlert(
          "danger",
          `${result.message || "Unknown / Unregistered Member"}`
        );
      }
    }

    // Refresh immediately to update stats and table
    await loadDashboardData();

  } catch (err) {
    console.error("Scan error:", err);
    showScanAlert("danger", "Backend connection error. Make sure Flask is running.");
  } finally {
    if (btnScan) {
      btnScan.disabled = false;
      btnScan.innerHTML = '<i class="fa-solid fa-wifi"></i> SCAN CARD';
    }
  }
}

/* ==========================================================================
   Alert Banner Helper
   ========================================================================== */
function showScanAlert(type, message) {
  const box = document.getElementById("scan-alert-box");
  const text = document.getElementById("scan-alert-text");
  const icon = document.getElementById("scan-alert-icon");
  if (!box || !text) return;

  box.className = `scan-notification-bar show ${type}`;
  text.textContent = message;

  if (icon) {
    if (type === "success") icon.className = "fa-solid fa-circle-check";
    else if (type === "warning") icon.className = "fa-solid fa-triangle-exclamation";
    else icon.className = "fa-solid fa-circle-xmark";
  }
}

/* ==========================================================================
   Load Dashboard API Data & Render
   ========================================================================== */
async function loadDashboardData() {
  try {
    const res = await fetch(`${API_BASE}/api/dashboard`);
    if (!res.ok) throw new Error("Dashboard API returned " + res.status);
    const data = await res.json();

    // 1. Update KPI Counters
    document.getElementById("stat-total").textContent = data.total_members ?? 0;
    document.getElementById("stat-present").textContent = data.present_count ?? 0;
    document.getElementById("stat-exited").textContent = data.exited_count ?? 0;
    document.getElementById("stat-not-scanned").textContent = data.not_scanned_count ?? 0;

    // 2. Update Latest Scan Section
    renderLatestScan(data.latest_scan);

    // 3. Update Attendance Table Cache & Display
    if (Array.isArray(data.today_attendance)) {
      attendanceCache = data.today_attendance;
      applyFiltersAndRender();
    }
  } catch (err) {
    console.error("Error fetching dashboard data:", err);
  }
}

/* ==========================================================================
   Render Latest Scan
   ========================================================================== */
function renderLatestScan(scan) {
  const container = document.getElementById("latest-scan-container");
  if (!container) return;

  if (!scan) {
    container.innerHTML = `
      <div class="activity-empty-state">
        <i class="fa-regular fa-id-badge"></i>
        <p style="font-weight: 500;">No scans yet</p>
        <span style="font-size: 0.8rem; color: var(--text-dim);">Tap a card to view recent access activity</span>
      </div>
    `;
    return;
  }

  const isEntry = scan.action === "ENTRY" || scan.status === "PRESENT";
  const actionLabel = scan.action ? `${scan.action} RECORDED` : (isEntry ? "ENTRY RECORDED" : "EXIT RECORDED");
  const actionBadgeClass = isEntry ? "ENTRY" : "EXIT";

  container.innerHTML = `
    <div class="activity-person-row">
      <div>
        <div class="activity-person-name">${escapeHtml(scan.name)}</div>
        <div class="activity-person-dept">${escapeHtml(scan.department || 'N/A')}</div>
      </div>
      <span class="action-pill ${actionBadgeClass}">${actionLabel}</span>
    </div>

    <div class="activity-meta-grid">
      <div class="meta-field">
        <span class="meta-field-label">USN / Tag ID</span>
        <span class="meta-field-value">${escapeHtml(scan.usn)}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Timestamp</span>
        <span class="meta-field-value">${escapeHtml(scan.time || '--')}</span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Session Status</span>
        <span class="meta-field-value">
          <span class="status-pill ${scan.status}">${scan.status}</span>
        </span>
      </div>
      <div class="meta-field">
        <span class="meta-field-label">Reader Gateway</span>
        <span class="meta-field-value" style="color: var(--primary); font-size: 0.8rem;">ESP32 Node-01</span>
      </div>
    </div>
  `;
}

/* ==========================================================================
   Table Filtering & Rendering
   ========================================================================== */
function initTableFilters() {
  const searchInput = document.getElementById("table-search");
  const statusFilter = document.getElementById("status-filter");

  if (searchInput) searchInput.addEventListener("input", applyFiltersAndRender);
  if (statusFilter) statusFilter.addEventListener("change", applyFiltersAndRender);
}

function applyFiltersAndRender() {
  const tbody = document.getElementById("attendance-table-body");
  if (!tbody) return;

  const searchQuery = (document.getElementById("table-search")?.value || "").toLowerCase().trim();
  const selectedStatus = document.getElementById("status-filter")?.value || "ALL";

  const filtered = attendanceCache.filter(item => {
    const matchesSearch =
      (item.name || "").toLowerCase().includes(searchQuery) ||
      (item.usn || "").toLowerCase().includes(searchQuery) ||
      (item.department || "").toLowerCase().includes(searchQuery);

    const matchesStatus =
      selectedStatus === "ALL" || item.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2rem;">
          No matching members found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const statusClass = (row.status || "NOT SCANNED").replace(/\s+/g, "_");
    const deptClass = row.department === "EAC" ? "EAC" : "CSE";

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(row.name)}</td>
        <td><span class="dept-badge ${deptClass}">${escapeHtml(row.department)}</span></td>
        <td><span class="usn-text-tag">${escapeHtml(row.usn)}</span></td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem;">${row.in_time ? row.in_time : '<span style="color: var(--text-dim);">--</span>'}</td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem;">${row.out_time ? row.out_time : '<span style="color: var(--text-dim);">--</span>'}</td>
        <td>
          <span class="status-pill ${statusClass}">${row.status || 'NOT SCANNED'}</span>
        </td>
        <td>
          <button class="btn-inline-scan" onclick="simulateRowScan('${escapeHtml(row.usn)}')">
            <i class="fa-solid fa-wifi"></i> Tap Card
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// Global handler for row-level "Tap Card" button
window.simulateRowScan = function(usn) {
  const selectEl = document.getElementById("member-select");
  if (selectEl) {
    selectEl.value = usn;
  }
  executeScan(usn);
};

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
