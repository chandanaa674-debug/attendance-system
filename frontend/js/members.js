/**
 * SRINIVAS INSTITUTE OF TECHNOLOGY | TechBots RFID Attendance System
 * Members Directory Controller
 */

const API_BASE = window.location.origin.includes("5000") ? window.location.origin : "http://127.0.0.1:5000";

let membersList = [];
let todayStatusMap = {};

document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initListeners();
  loadData();
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
  const searchInput = document.getElementById("member-search");
  const deptFilter = document.getElementById("member-dept-filter");
  const btnRefresh = document.getElementById("btn-refresh-members");

  if (searchInput) searchInput.addEventListener("input", renderTable);
  if (deptFilter) deptFilter.addEventListener("change", renderTable);
  if (btnRefresh) btnRefresh.addEventListener("click", loadData);
}

async function loadData() {
  try {
    const membersRes = await fetch(`${API_BASE}/api/members`);
    const membersData = await membersRes.json();
    membersList = membersData.members || [];

    try {
      const attRes = await fetch(`${API_BASE}/api/attendance/today`);
      const attData = await attRes.json();
      todayStatusMap = {};
      if (attData.records) {
        attData.records.forEach(r => {
          todayStatusMap[r.usn] = r.status;
        });
      }
    } catch (e) {
      console.warn("Could not fetch today's attendance for status map:", e);
    }

    populateDepartmentFilter();
    updateStats();
    renderTable();

  } catch (err) {
    console.error("Error loading members:", err);
    const tbody = document.getElementById("members-table-body");
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
            Failed to load members from backend. Please ensure Flask is running.
          </td>
        </tr>
      `;
    }
  }
}

function populateDepartmentFilter() {
  const deptSelect = document.getElementById("member-dept-filter");
  if (!deptSelect) return;

  const currentVal = deptSelect.value;
  const depts = Array.from(new Set(membersList.map(m => m.department).filter(Boolean))).sort();

  deptSelect.innerHTML = '<option value="ALL">All Departments</option>';
  depts.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    if (d === currentVal) opt.selected = true;
    deptSelect.appendChild(opt);
  });
}

function updateStats() {
  const totalEl = document.getElementById("member-total-count");
  const deptEl = document.getElementById("member-dept-count");
  const activeEl = document.getElementById("member-active-today");

  if (totalEl) totalEl.textContent = membersList.length;

  const depts = new Set(membersList.map(m => m.department).filter(Boolean));
  if (deptEl) deptEl.textContent = depts.size;

  let activeCount = 0;
  Object.values(todayStatusMap).forEach(st => {
    if (st === "PRESENT" || st === "EXITED") activeCount++;
  });
  if (activeEl) activeEl.textContent = activeCount;
}

function renderTable() {
  const tbody = document.getElementById("members-table-body");
  if (!tbody) return;

  const query = (document.getElementById("member-search")?.value || "").toLowerCase().trim();
  const selectedDept = document.getElementById("member-dept-filter")?.value || "ALL";

  const filtered = membersList.filter(m => {
    const matchesSearch =
      (m.name || "").toLowerCase().includes(query) ||
      (m.usn || "").toLowerCase().includes(query) ||
      (m.department || "").toLowerCase().includes(query);

    const matchesDept =
      selectedDept === "ALL" || m.department === selectedDept;

    return matchesSearch && matchesDept;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2.5rem;">
          No members found matching your search criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((m, index) => {
    const status = todayStatusMap[m.usn] || "NOT SCANNED";
    const statusClass = status.replace(/\s+/g, "_");
    const deptClass = m.department === "EAC" ? "EAC" : "CSE";

    return `
      <tr>
        <td style="color: var(--text-dim); font-size: 0.82rem;">${index + 1}</td>
        <td style="font-weight: 600;">${escapeHtml(m.name)}</td>
        <td><span class="dept-badge ${deptClass}">${escapeHtml(m.department)}</span></td>
        <td><span class="usn-text-tag">${escapeHtml(m.usn)}</span></td>
        <td><span class="status-pill ${statusClass}">${status}</span></td>
        <td>
          <button class="btn-inline-scan" onclick="scanMemberFromTable('${escapeHtml(m.usn)}')">
            <i class="fa-solid fa-wifi"></i> Simulate Scan
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.scanMemberFromTable = async function(usn) {
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

    await loadData();
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
