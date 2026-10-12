/**
 * TechBots-SIT RFID Attendance System
 * Members Directory & Admin Management Controller
 */

const API_BASE = window.location.origin;

let membersList = [];
let todayStatusMap = {};
let isAdminLoggedIn = false;
let sortColumn = "name";
let sortDirection = "asc";
let currentPage = 1;
let pageSize = 10;


document.addEventListener("DOMContentLoaded", async () => {
  await checkAdminSession();
  initAuthHeader();
  initModals();
  bindMemberEvents();
  await loadMembersData();
  if (isAdminLoggedIn) {
    checkDuplicateRecords();
  }
});

async function checkAdminSession() {
  const token = localStorage.getItem("techbots_admin_token");
  if (!token) {
    isAdminLoggedIn = false;
    renderVisitorState();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    isAdminLoggedIn = data.authenticated === true;
  } catch (e) {
    isAdminLoggedIn = false;
  }

  if (isAdminLoggedIn) {
    renderAdminState();
  } else {
    localStorage.removeItem("techbots_admin_token");
    renderVisitorState();
  }
}

function renderAdminState() {
  const banner = document.getElementById("visitor-mode-banner");
  if (banner) banner.style.display = "none";

  const actionsSlot = document.getElementById("admin-action-buttons");
  if (actionsSlot) {
    actionsSlot.innerHTML = `
      <button class="btn-primary-scan" id="btn-open-add">
        <i class="fa-solid fa-user-plus"></i> Add Member
      </button>
      <button class="btn-secondary" id="btn-open-import">
        <i class="fa-solid fa-file-excel"></i> Import Excel
      </button>
      <a href="${API_BASE}/api/members/backup" class="btn-secondary" id="btn-dl-backup" download>
        <i class="fa-solid fa-download"></i> Download Backup
      </a>
      <button class="btn-secondary" id="btn-check-dups">
        <i class="fa-solid fa-shield-virus"></i> Check Duplicates
      </button>
    `;

    document.getElementById("btn-open-add").addEventListener("click", () => openModal("modal-add-member"));
    document.getElementById("btn-open-import").addEventListener("click", () => openModal("modal-import-excel"));
    document.getElementById("btn-check-dups").addEventListener("click", checkDuplicateRecords);

    // Backup download needs auth token
    const dlBtn = document.getElementById("btn-dl-backup");
    dlBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const token = localStorage.getItem("techbots_admin_token");
      try {
        const resp = await fetch(`${API_BASE}/api/members/backup`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (resp.ok) {
          const blob = await resp.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `TechBots_Members_Backup_${new Date().toISOString().split("T")[0]}.xlsx`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          alert("Backup download failed: Unauthorized");
        }
      } catch (err) {
        alert("Failed to download backup.");
      }
    });
  }
}

function renderVisitorState() {
  const banner = document.getElementById("visitor-mode-banner");
  if (banner) banner.style.display = "flex";
  const actionsSlot = document.getElementById("admin-action-buttons");
  if (actionsSlot) actionsSlot.innerHTML = "";
}

function initAuthHeader() {
  const slot = document.getElementById("auth-header-slot");
  if (!slot) return;
  const token = localStorage.getItem("techbots_admin_token");
  if (token) {
    slot.innerHTML = `
      <span class="admin-logged-in-pill"><i class="fa-solid fa-user-shield"></i> Admin Active</span>
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

function bindMemberEvents() {
  const searchInput = document.getElementById("member-search");
  if (searchInput) searchInput.addEventListener("input", () => { currentPage = 1; filterAndRenderMembers(); });

  const deptFilter = document.getElementById("member-dept-filter");
  if (deptFilter) deptFilter.addEventListener("change", () => { currentPage = 1; filterAndRenderMembers(); });

  const branchFilter = document.getElementById("member-branch-filter");
  if (branchFilter) branchFilter.addEventListener("change", () => { currentPage = 1; filterAndRenderMembers(); });

  const pageSizeSelect = document.getElementById("members-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", (e) => {
      pageSize = e.target.value === "ALL" ? 999999 : parseInt(e.target.value, 10);
      currentPage = 1;
      filterAndRenderMembers();
    });
  }

  const refreshBtn = document.getElementById("btn-refresh-members");
  if (refreshBtn) refreshBtn.addEventListener("click", loadMembersData);

  // Column Sort Listeners
  document.querySelectorAll("#members-roster-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (sortColumn === col) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = col;
        sortDirection = "asc";
      }
      updateMemberSortIndicators();
      filterAndRenderMembers();
    });
  });

  // Form Submits
  const addForm = document.getElementById("form-add-member");
  if (addForm) addForm.addEventListener("submit", handleAddMemberSubmit);

  const editForm = document.getElementById("form-edit-member");
  if (editForm) editForm.addEventListener("submit", handleEditMemberSubmit);

  const importForm = document.getElementById("form-import-excel");
  if (importForm) importForm.addEventListener("submit", handleImportExcelSubmit);
}

function updateMemberSortIndicators() {
  document.querySelectorAll("#members-roster-table th.sortable").forEach(th => {
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


async function loadMembersData() {
  const tbody = document.getElementById("members-table-body");
  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 2rem;">
        <i class="fa-solid fa-spinner fa-spin"></i> Loading club members...
      </td>
    </tr>
  `;

  try {
    // 1. Fetch Members
    const res = await fetch(`${API_BASE}/api/members`);
    const data = await res.json();

    // 2. Fetch Today Attendance for Status Badges
    try {
      const attRes = await fetch(`${API_BASE}/api/attendance/today`);
      const attData = await attRes.json();
      if (attData.success && Array.isArray(attData.records)) {
        todayStatusMap = {};
        attData.records.forEach(r => {
          todayStatusMap[r.usn.replace(/\s+/g, "").toUpperCase()] = r.status;
        });
      }
    } catch (e) {
      console.warn("Could not load today status map:", e);
    }

    if (data.success && Array.isArray(data.members)) {
      membersList = data.members;

      // Update KPIs
      document.getElementById("member-total-count").textContent = membersList.length;
      const rfidCount = membersList.filter(m => m.rfid_uid && m.rfid_uid.trim().length > 0).length;
      document.getElementById("member-rfid-count").textContent = rfidCount;

      const activeTodayCount = Object.values(todayStatusMap).filter(s => s === "Present" || s === "Left").length;
      document.getElementById("member-active-today").textContent = activeTodayCount;

      // Populate Filters (Dept & Branch)
      populateMemberFilters(membersList);

      // Render table
      filterAndRenderMembers();

    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
            Failed to load members: ${data.error || "Unknown error"}
          </td>
        </tr>
      `;
    }
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--status-danger-text); padding: 2rem;">
          Could not communicate with server. Please verify Flask backend is running.
        </td>
      </tr>
    `;
  }
}

function populateMemberFilters(members) {
  const deptSelect = document.getElementById("member-dept-filter");
  if (deptSelect) {
    const currentVal = deptSelect.value;
    const depts = new Set();
    members.forEach(m => {
      if (m.department) depts.add(m.department.toUpperCase());
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

  const branchSelect = document.getElementById("member-branch-filter");
  if (branchSelect) {
    const currentVal = branchSelect.value;
    const branches = new Set();
    members.forEach(m => {
      if (m.branch) branches.add(m.branch);
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

function filterAndRenderMembers() {
  const tbody = document.getElementById("members-table-body");
  if (!tbody) return;

  const q = (document.getElementById("member-search").value || "").trim().toLowerCase();
  const dept = (document.getElementById("member-dept-filter").value || "ALL").toUpperCase();
  const branch = (document.getElementById("member-branch-filter")?.value || "ALL").toLowerCase();

  let filtered = membersList.filter(m => {
    if (dept !== "ALL" && (m.department || "").toUpperCase() !== dept) return false;
    if (branch !== "ALL" && (m.branch || "").toLowerCase() !== branch) return false;
    if (q) {
      const match = (m.name || "").toLowerCase().includes(q) ||
                    (m.usn || "").toLowerCase().includes(q) ||
                    (m.department || "").toLowerCase().includes(q) ||
                    (m.branch || "").toLowerCase().includes(q) ||
                    (m.rfid_uid || "").toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Sorting
  if (sortColumn) {
    filtered.sort((a, b) => {
      let valA = "";
      let valB = "";

      if (sortColumn === "status") {
        const keyA = (a.usn || "").replace(/\s+/g, "").toUpperCase();
        const keyB = (b.usn || "").replace(/\s+/g, "").toUpperCase();
        valA = todayStatusMap[keyA] || "Not Marked";
        valB = todayStatusMap[keyB] || "Not Marked";
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
  const infoEl = document.getElementById("members-pagination-info");
  if (infoEl) {
    infoEl.textContent = totalRecords === 0
      ? "Showing 0 of 0 records"
      : `Showing ${startIndex + 1} to ${endIndex} of ${totalRecords} records`;
  }

  renderMemberPaginationControls(totalPages);

  if (pagedRecords.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2.5rem 1rem;">
          <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>
          No matching members found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pagedRecords.map((m) => {
    const canonicalKey = (m.usn || "").replace(/\s+/g, "").toUpperCase();
    const todayStatus = todayStatusMap[canonicalKey] || "Not Marked";

    let statusBadge = `<span class="status-pill not-marked"><i class="fa-regular fa-clock"></i> Not Marked</span>`;
    if (todayStatus === "Present") {
      statusBadge = `<span class="status-pill present"><i class="fa-solid fa-door-open"></i> Present</span>`;
    } else if (todayStatus === "Left") {
      statusBadge = `<span class="status-pill left"><i class="fa-solid fa-door-closed"></i> Left</span>`;
    }

    const rfidBadge = m.rfid_uid
      ? `<span class="badge-rfid"><i class="fa-solid fa-id-card"></i> ${escapeHtml(m.rfid_uid)}</span>`
      : `<span style="color: var(--text-dim); font-size: 0.78rem;">Unassigned</span>`;

    let actionsCell = `<span style="color: var(--text-dim); font-size: 0.8rem;">Read-Only</span>`;
    if (isAdminLoggedIn) {
      actionsCell = `
        <div style="display: flex; gap: 0.4rem;">
          <button class="btn-secondary btn-action-edit" data-usn="${escapeHtml(m.usn)}" style="padding: 0.3rem 0.6rem; font-size: 0.78rem;">
            <i class="fa-solid fa-pen-to-square"></i> Edit / Tag
          </button>
          <button class="btn-secondary btn-action-delete" data-usn="${escapeHtml(m.usn)}" data-name="${escapeHtml(m.name)}" style="padding: 0.3rem 0.6rem; font-size: 0.78rem; color: #991b1b;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;
    }

    return `
      <tr>
        <td><strong>${escapeHtml(m.name)}</strong></td>
        <td><span class="dept-badge">${escapeHtml(m.department || "General")}</span></td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(m.branch || "-")}</td>
        <td style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(m.usn)}</td>
        <td>${rfidBadge}</td>
        <td>${statusBadge}</td>
        <td>${actionsCell}</td>
      </tr>
    `;
  }).join("");

  // Attach Edit/Delete Listeners
  if (isAdminLoggedIn) {
    document.querySelectorAll(".btn-action-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const usn = btn.getAttribute("data-usn");
        openEditModal(usn);
      });
    });

    document.querySelectorAll(".btn-action-delete").forEach(btn => {
      btn.addEventListener("click", () => {
        const usn = btn.getAttribute("data-usn");
        const name = btn.getAttribute("data-name");
        handleDeleteMember(usn, name);
      });
    });
  }
}

function renderMemberPaginationControls(totalPages) {
  const container = document.getElementById("members-pagination-controls");
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <button class="btn-page" id="btn-mem-prev" ${currentPage === 1 ? "disabled" : ""} title="Previous Page">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    html += `
      <button class="btn-page ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>
    `;
  }

  html += `
    <button class="btn-page" id="btn-mem-next" ${currentPage === totalPages ? "disabled" : ""} title="Next Page">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  container.innerHTML = html;

  const btnPrev = document.getElementById("btn-mem-prev");
  if (btnPrev) btnPrev.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      filterAndRenderMembers();
    }
  });

  const btnNext = document.getElementById("btn-mem-next");
  if (btnNext) btnNext.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      filterAndRenderMembers();
    }
  });

  container.querySelectorAll(".btn-page[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentPage = parseInt(btn.getAttribute("data-page"), 10);
      filterAndRenderMembers();
    });
  });
}


// -------------------------------------------------------------
// Modals & Forms
// -------------------------------------------------------------
function initModals() {
  document.querySelectorAll("[data-close]").forEach(el => {
    el.addEventListener("click", () => {
      const modalId = el.getAttribute("data-close");
      closeModal(modalId);
    });
  });

  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) {
      e.target.classList.remove("active");
    }
  });
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("active");
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("active");
}

function openEditModal(usn) {
  const m = membersList.find(x => x.usn === usn);
  if (!m) return;

  document.getElementById("edit-orig-usn").value = m.usn;
  document.getElementById("edit-usn").value = m.usn;
  document.getElementById("edit-name").value = m.name;
  document.getElementById("edit-dept").value = m.department;
  document.getElementById("edit-branch").value = m.branch || "";
  document.getElementById("edit-rfid").value = m.rfid_uid || "";

  const alertBox = document.getElementById("edit-member-alert");
  if (alertBox) alertBox.style.display = "none";

  openModal("modal-edit-member");
}

async function handleAddMemberSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById("add-member-alert");
  alertBox.style.display = "none";

  const token = localStorage.getItem("techbots_admin_token");
  if (!token) {
    alert("Admin authentication expired. Please sign in again.");
    return;
  }

  const payload = {
    name: document.getElementById("add-name").value.trim(),
    usn: document.getElementById("add-usn").value.trim(),
    department: document.getElementById("add-dept").value.trim(),
    branch: document.getElementById("add-branch").value.trim(),
    rfid_uid: document.getElementById("add-rfid").value.trim()
  };

  try {
    const res = await fetch(`${API_BASE}/api/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeModal("modal-add-member");
      document.getElementById("form-add-member").reset();
      await loadMembersData();
      alert("Member registered successfully!");
    } else {
      alertBox.className = "alert-banner error";
      alertBox.textContent = data.error || "Failed to add member.";
      alertBox.style.display = "flex";
    }
  } catch (err) {
    alertBox.className = "alert-banner error";
    alertBox.textContent = "Network error while saving member.";
    alertBox.style.display = "flex";
  }
}

async function handleEditMemberSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById("edit-member-alert");
  alertBox.style.display = "none";

  const token = localStorage.getItem("techbots_admin_token");
  const usn = document.getElementById("edit-orig-usn").value;

  const payload = {
    name: document.getElementById("edit-name").value.trim(),
    department: document.getElementById("edit-dept").value.trim(),
    branch: document.getElementById("edit-branch").value.trim(),
    rfid_uid: document.getElementById("edit-rfid").value.trim()
  };

  try {
    const res = await fetch(`${API_BASE}/api/members/${encodeURIComponent(usn)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeModal("modal-edit-member");
      await loadMembersData();
      alert("Member details and RFID UID updated successfully!");
    } else {
      alertBox.className = "alert-banner error";
      alertBox.textContent = data.error || "Failed to update member.";
      alertBox.style.display = "flex";
    }
  } catch (err) {
    alertBox.className = "alert-banner error";
    alertBox.textContent = "Network error while updating member.";
    alertBox.style.display = "flex";
  }
}

async function handleDeleteMember(usn, name) {
  if (!confirm(`Are you sure you want to remove member '${name}' (${usn}) from the club roster?\nA backup will be created automatically before deletion.`)) {
    return;
  }

  const token = localStorage.getItem("techbots_admin_token");
  try {
    const res = await fetch(`${API_BASE}/api/members/${encodeURIComponent(usn)}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      await loadMembersData();
      alert(`Member '${name}' deleted successfully.`);
    } else {
      alert(`Deletion failed: ${data.error || "Unknown error"}`);
    }
  } catch (err) {
    alert("Network error while deleting member.");
  }
}

async function handleImportExcelSubmit(e) {
  e.preventDefault();
  const fileInput = document.getElementById("import-file");
  const alertBox = document.getElementById("import-alert");
  const submitBtn = document.getElementById("btn-import-submit");

  if (!fileInput.files || fileInput.files.length === 0) {
    alert("Please select an Excel file to import.");
    return;
  }

  const token = localStorage.getItem("techbots_admin_token");
  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing...';

  try {
    const res = await fetch(`${API_BASE}/api/members/import`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: formData
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeModal("modal-import-excel");
      document.getElementById("form-import-excel").reset();
      await loadMembersData();
      alert(`Import complete!\nImported: ${data.imported_count} new members\nSkipped: ${data.skipped_count} (duplicates/blanks)`);
    } else {
      alertBox.className = "alert-banner error";
      alertBox.textContent = data.error || "Excel import failed.";
      alertBox.style.display = "flex";
    }
  } catch (err) {
    alertBox.className = "alert-banner error";
    alertBox.textContent = "Error uploading file to server.";
    alertBox.style.display = "flex";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Start Import';
  }
}

async function checkDuplicateRecords() {
  const token = localStorage.getItem("techbots_admin_token");
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE}/api/members/duplicates`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();

    const warnBox = document.getElementById("duplicate-warning-box");
    const warnText = document.getElementById("duplicate-warning-text");

    const dupUsns = Object.keys(data.duplicate_usns || {});
    const dupRfids = Object.keys(data.duplicate_rfids || {});

    if (dupUsns.length > 0 || dupRfids.length > 0) {
      let msg = "Warning: Duplicate records identified in Excel: ";
      if (dupUsns.length > 0) msg += `Duplicate USNs: [${dupUsns.join(", ")}]. `;
      if (dupRfids.length > 0) msg += `Duplicate RFID UIDs: [${dupRfids.join(", ")}].`;
      warnText.textContent = msg;
      warnBox.style.display = "flex";
    } else {
      warnBox.style.display = "none";
    }
  } catch (e) {
    console.warn("Could not check duplicates:", e);
  }
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
