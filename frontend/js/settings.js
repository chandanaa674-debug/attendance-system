/**
 * SRINIVAS INSTITUTE OF TECHNOLOGY | TechBots RFID Attendance System
 * Settings & System Diagnostics Controller
 */

(function () {
  'use strict';

  const API_BASE = window.location.origin;

  function showAlert(msg, isSuccess = true) {
    const alertBox = document.getElementById('settings-alert');
    if (!alertBox) return;
    alertBox.className = `alert-banner ${isSuccess ? 'success' : 'error'}`;
    alertBox.innerHTML = `<i class="fa-solid ${isSuccess ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${msg}`;
    alertBox.style.display = 'flex';
    setTimeout(() => {
      alertBox.style.display = 'none';
    }, 6000);
  }

  async function loadSettings() {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.institution) {
        const colEl = document.getElementById('val-college');
        const locEl = document.getElementById('val-location');
        const clubEl = document.getElementById('val-club');
        if (colEl) colEl.textContent = data.institution.college_name || 'Srinivas Institute of Technology';
        if (locEl) locEl.textContent = data.institution.college_location || 'Valachil, Mangaluru';
        if (clubEl) clubEl.textContent = data.institution.club_name || 'TechBots Club';
      }

      if (data.attendance_rules) {
        const tzEl = document.getElementById('val-timezone');
        const ruleEl = document.getElementById('val-rule-mode');
        const cdInput = document.getElementById('input-cooldown');
        if (tzEl) tzEl.textContent = data.attendance_rules.timezone || 'Asia/Kolkata';
        if (ruleEl) ruleEl.textContent = data.attendance_rules.entry_exit_mode || 'strict_single_session';
        if (cdInput) cdInput.value = data.attendance_rules.rapid_scan_cooldown_seconds ?? 15;
      }

      if (data.storage) {
        const memEl = document.getElementById('val-file-members');
        const attEl = document.getElementById('val-file-attendance');
        const totEl = document.getElementById('val-total-members');
        const bkpEl = document.getElementById('badge-backups-count');
        if (memEl) memEl.textContent = `data/${data.storage.members_excel_file || 'club_members.xlsx'}`;
        if (attEl) attEl.textContent = `data/${data.storage.attendance_excel_file || 'attendance_records.xlsx'}`;
        if (totEl) totEl.textContent = data.storage.total_registered_members ?? 9;
        if (bkpEl) bkpEl.textContent = `${data.storage.total_backup_snapshots ?? 0} Backups`;
      }
    } catch (err) {
      console.warn('Could not load settings:', err);
    }
  }

  function initForms() {
    // Cooldown update
    const formCd = document.getElementById('form-cooldown');
    if (formCd) {
      formCd.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('techbots_admin_token');
        if (!token) {
          showAlert('Administrator login required to update system settings. Please log in via Admin portal.', false);
          return;
        }

        const cdVal = parseInt(document.getElementById('input-cooldown').value, 10);
        const saveBtn = document.getElementById('btn-save-cooldown');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        try {
          const res = await fetch(`${API_BASE}/api/settings`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ rapid_scan_cooldown_seconds: cdVal })
          });

          const resData = await res.json();
          if (res.ok && resData.success) {
            showAlert('Attendance debounce cooldown saved successfully.', true);
          } else {
            showAlert(resData.error || 'Failed to update settings. Session might have expired.', false);
          }
        } catch (err) {
          showAlert(`Error saving settings: ${err.message}`, false);
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save Cooldown';
        }
      });
    }

    // Download members backup
    const btnDl = document.getElementById('btn-download-backup-xlsx');
    if (btnDl) {
      btnDl.addEventListener('click', () => {
        window.location.href = `${API_BASE}/api/members/backup`;
      });
    }

    // Trigger immediate backup snapshot
    const btnSnap = document.getElementById('btn-create-snapshot-now');
    if (btnSnap) {
      btnSnap.addEventListener('click', async () => {
        const token = localStorage.getItem('techbots_admin_token');
        if (!token) {
          showAlert('Administrator login required to generate backup snapshots.', false);
          return;
        }

        btnSnap.disabled = true;
        btnSnap.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating snapshot...';

        try {
          const res = await fetch(`${API_BASE}/api/settings/backup_now`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showAlert(`Backup created: ${data.snapshots_created.join(', ')}`, true);
            loadSettings();
          } else {
            showAlert(data.error || 'Snapshot creation failed.', false);
          }
        } catch (err) {
          showAlert(`Error creating snapshot: ${err.message}`, false);
        } finally {
          btnSnap.disabled = false;
          btnSnap.innerHTML = '<i class="fa-solid fa-camera"></i> Snapshot Workbooks Now';
        }
      });
    }

    // Run Diagnostics
    const btnDiag = document.getElementById('btn-run-diagnostics');
    const outDiag = document.getElementById('diagnostics-output');
    if (btnDiag && outDiag) {
      btnDiag.addEventListener('click', async () => {
        btnDiag.disabled = true;
        btnDiag.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
        outDiag.textContent = 'Contacting backend /api/health endpoint...';

        try {
          const startTime = performance.now();
          const res = await fetch(`${API_BASE}/api/health`);
          const elapsed = Math.round(performance.now() - startTime);
          const data = await res.json();

          outDiag.textContent = JSON.stringify({
            http_status: res.status,
            latency_ms: elapsed,
            ...data
          }, null, 2);
        } catch (err) {
          outDiag.textContent = `Diagnostics error: ${err.message}\nMake sure the Flask backend is reachable.`;
        } finally {
          btnDiag.disabled = false;
          btnDiag.innerHTML = '<i class="fa-solid fa-play"></i> Run Health Diagnostic';
        }
      });
    }

    // Refresh Settings button
    const btnRef = document.getElementById('btn-refresh-settings');
    if (btnRef) {
      btnRef.addEventListener('click', () => {
        loadSettings();
        showAlert('Settings refreshed from server.', true);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initForms();
  });
})();
