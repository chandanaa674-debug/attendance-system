/**
 * SRINIVAS INSTITUTE OF TECHNOLOGY | TechBots RFID Attendance System
 * Today's Attendance Page Controller
 */

const API_BASE = window.location.origin.includes("5000") ? window.location.origin : "http://127.0.0.1:5000";

let recordsCache = [];

document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initListeners();
  loadAttendanceToday();

  // Background refresh every 6 seconds
  setInterval(loadAttendanceToday, 6000);
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

function initListeners() {
  const searchInput = document.getElementById("attendance-search");
  const statusFilter = document.getElementById("status-filter");
  const btnRefresh = document.getElementById("btn-refresh-attendance");

  if (searchInput) searchInput.addEventListener("input", renderAttendanceTable);
  if (statusFilter) statusFilter.addEventListener("change", renderAttendanceTable);
  if (btnRefresh) btnRefresh.addEventListener("click", loadAttendanceToday);
}

async function loadAttendanceToday() {
  try {
    const res = await fetch(`${API_BASE}/api/attendance/today`);
    const data = await res.json();

    if (data.success && Array.isArray(data.records)) {
      recordsCache = data.records;

      const dateEl = document.getElementById("attendance-session-date");
      if (dateEl) {
        const todayStr = data.date || new Date().toISOString().split("T")[0];
        dateEl.textContent = `Session Date: ${todayStr} • TechBots Live Access Log`;
      }

      const exportBtn = document.getElementById("btn-export-today");
      if (exportBtn) {
        exportBtn.href = `${API_BASE}/api/attendance/export?date=${data.date || ''}`;
      }

      const total = recordsCache.length;
      const present = recordsCache.filter(r => r.status === "PRESENT").length;
      const exited = recordsCache.filter(r => r.status === "EXITED").length;
      const notScanned = recordsCache.filter(r => r.status === "NOT SCANNED").length;

      document.getElementById("card-total").textContent = total;
      document.getElementById("card-present").textContent = present;
      document.getElementById("card-exited").textContent = exited;
      document.getElementById("card-not-scanned").textContent = notScanned;

      renderAttendanceTable();
    }
  } catch (err) {
    console.error("Error loading today's attendance:", err);
    const tbody = document.getElementById("attendance-today-body");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
            Failed to connect to backend server. Make sure Flask is running.
          </td>
        </tr>
      `;
    }
  }
}

function renderAttendanceTable() {
  const tbody = document.getElementById("attendance-today-body");
  if (!tbody) return;

  const query = (document.getElementById("attendance-search")?.value || "").toLowerCase().trim();
  const selectedStatus = document.getElementById("status-filter")?.value || "ALL";

  const filtered = recordsCache.filter(r => {
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
          No matching session records found.
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
        <td style="font-weight: 600;">${escapeHtml(r.name)}</td>
        <td><span class="dept-badge ${deptClass}">${escapeHtml(r.department)}</span></td>
        <td><span class="usn-text-tag">${escapeHtml(r.usn)}</span></td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem;">${r.in_time ? r.in_time : '<span style="color: var(--text-dim);">--</span>'}</td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem;">${r.out_time ? r.out_time : '<span style="color: var(--text-dim);">--</span>'}</td>
        <td><span class="status-pill ${statusClass}">${r.status}</span></td>
        <td>
          <button class="btn-inline-scan" onclick="triggerAttendanceScan('${escapeHtml(r.usn)}')">
            <i class="fa-solid fa-wifi"></i> Tap Card
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.triggerAttendanceScan = async function(usn) {
  try {
    const res = await fetch(`${API_BASE}/api/rfid/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: usn })
    });
    const result = await res.json();

    if (result.success) {
      alert(`[RFID SIMULATION: ${result.action}]\nMember: ${result.name}\nDepartment: ${result.department}\nTimestamp: ${result.time}\nStatus: ${result.status}`);
    } else {
      alert(`[RFID SIMULATION INFO]\n${result.message}`);
    }

    await loadAttendanceToday();
  } catch (err) {
    alert("Error executing scan: " + err.message);
  }
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
