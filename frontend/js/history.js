/**
 * SRINIVAS INSTITUTE OF TECHNOLOGY | TechBots RFID Attendance System
 * Attendance History Page Controller
 */

const API_BASE = window.location.origin.includes("5000") ? window.location.origin : "http://127.0.0.1:5000";

let historyCache = [];

document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initDatePicker();
  initListeners();
  loadHistoryForSelectedDate();
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

function initDatePicker() {
  const picker = document.getElementById("history-date-picker");
  if (!picker) return;

  const today = new Date().toISOString().split("T")[0];
  picker.value = today;
}

function initListeners() {
  const btnFetch = document.getElementById("btn-fetch-history");
  const picker = document.getElementById("history-date-picker");
  const searchInput = document.getElementById("hist-table-search");
  const statusFilter = document.getElementById("hist-status-filter");

  if (btnFetch) btnFetch.addEventListener("click", loadHistoryForSelectedDate);
  if (picker) picker.addEventListener("change", loadHistoryForSelectedDate);
  if (searchInput) searchInput.addEventListener("input", renderHistoryTable);
  if (statusFilter) statusFilter.addEventListener("change", renderHistoryTable);
}

async function loadHistoryForSelectedDate() {
  const picker = document.getElementById("history-date-picker");
  const dateVal = picker?.value || new Date().toISOString().split("T")[0];

  try {
    const res = await fetch(`${API_BASE}/api/attendance/history?date=${encodeURIComponent(dateVal)}`);
    const data = await res.json();

    if (data.success) {
      historyCache = data.records || [];

      document.getElementById("history-date-display").textContent = data.date;

      const exportBtn = document.getElementById("btn-export-history");
      if (exportBtn) {
        exportBtn.href = `${API_BASE}/api/attendance/export?date=${encodeURIComponent(data.date)}`;
      }

      document.getElementById("hist-stat-present").textContent = data.present_count ?? 0;
      document.getElementById("hist-stat-exited").textContent = data.exited_count ?? 0;
      document.getElementById("hist-stat-not-scanned").textContent = data.not_scanned_count ?? 0;

      renderHistoryTable();
    }
  } catch (err) {
    console.error("Error fetching history:", err);
    const tbody = document.getElementById("history-table-body");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
            Failed to load history for selected date. Ensure backend is running.
          </td>
        </tr>
      `;
    }
  }
}

function renderHistoryTable() {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) return;

  const query = (document.getElementById("hist-table-search")?.value || "").toLowerCase().trim();
  const selectedStatus = document.getElementById("hist-status-filter")?.value || "ALL";

  const filtered = historyCache.filter(r => {
    const matchesSearch =
      (r.name || "").toLowerCase().includes(query) ||
      (r.usn || "").toLowerCase().includes(query) ||
      (r.department || "").toLowerCase().includes(query);

    const matchesStatus =
      selectedStatus === "ALL" || r.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2.5rem;">
          No attendance records found for this date.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const statusClass = (r.status || "NOT SCANNED").replace(/\s+/g, "_");
    const deptClass = r.department === "EAC" ? "EAC" : "CSE";

    return `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(r.date)}</td>
        <td style="font-weight: 600;">${escapeHtml(r.name)}</td>
        <td><span class="dept-badge ${deptClass}">${escapeHtml(r.department)}</span></td>
        <td><span class="usn-text-tag">${escapeHtml(r.usn)}</span></td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem;">${r.in_time ? r.in_time : '<span style="color: var(--text-dim);">--</span>'}</td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem;">${r.out_time ? r.out_time : '<span style="color: var(--text-dim);">--</span>'}</td>
        <td><span class="status-pill ${statusClass}">${r.status}</span></td>
      </tr>
    `;
  }).join("");
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
