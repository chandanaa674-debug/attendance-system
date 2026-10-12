/**
 * SRINIVAS INSTITUTE OF TECHNOLOGY | TechBots RFID Attendance System
 * Universal Navigation, Live Clock, and Administrator Authentication Controller
 */

(function () {
  'use strict';

  function initMobileNav() {
    const toggleBtn = document.getElementById('mobile-nav-toggle');
    const navMenu = document.querySelector('.nav-menu');

    if (!toggleBtn || !navMenu) return;

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navMenu.classList.toggle('open');
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

      const icon = toggleBtn.querySelector('i');
      if (icon) {
        if (isOpen) {
          icon.classList.remove('fa-bars');
          icon.classList.add('fa-xmark');
        } else {
          icon.classList.remove('fa-xmark');
          icon.classList.add('fa-bars');
        }
      }
    });

    // Dismiss menu when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (navMenu.classList.contains('open')) {
        if (!navMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
          navMenu.classList.remove('open');
          toggleBtn.setAttribute('aria-expanded', 'false');
          const icon = toggleBtn.querySelector('i');
          if (icon) {
            icon.classList.remove('fa-xmark');
            icon.classList.add('fa-bars');
          }
        }
      }
    });

    // Dismiss menu when pressing Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navMenu.classList.contains('open')) {
        navMenu.classList.remove('open');
        toggleBtn.setAttribute('aria-expanded', 'false');
        const icon = toggleBtn.querySelector('i');
        if (icon) {
          icon.classList.remove('fa-xmark');
          icon.classList.add('fa-bars');
        }
        toggleBtn.focus();
      }
    });

    // Close menu when resizing to desktop viewport to prevent inconsistent state
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768 && navMenu.classList.contains('open')) {
        navMenu.classList.remove('open');
        toggleBtn.setAttribute('aria-expanded', 'false');
        const icon = toggleBtn.querySelector('i');
        if (icon) {
          icon.classList.remove('fa-xmark');
          icon.classList.add('fa-bars');
        }
      }
    });
  }

  function initLiveClock() {
    const clockEl = document.getElementById('live-clock');
    if (!clockEl) return;

    function update() {
      const now = new Date();
      // Formatted in Asia/Kolkata timezone
      const timeStr = now.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      clockEl.textContent = `${timeStr} IST`;
    }

    update();
    setInterval(update, 1000);
  }

  function initAuthNavAndHeader() {
    const token = localStorage.getItem('techbots_admin_token');
    const headerSlot = document.getElementById('auth-header-slot');
    const navAuthItem = document.getElementById('nav-item-auth');

    function performLogout(e) {
      if (e) e.preventDefault();
      localStorage.removeItem('techbots_admin_token');
      window.location.href = 'login.html';
    }

    if (token) {
      // User is logged in as administrator
      if (headerSlot) {
        headerSlot.innerHTML = `
          <span class="admin-logged-in-pill"><i class="fa-solid fa-user-shield"></i> <strong id="header-admin-name">Admin</strong></span>
          <button id="btn-header-logout" class="btn-header-auth" style="margin-left: 0.4rem;" title="Sign out of Admin Session">
            <i class="fa-solid fa-right-from-bracket"></i> Logout
          </button>
        `;
        const btnHeaderLogout = document.getElementById('btn-header-logout');
        if (btnHeaderLogout) {
          btnHeaderLogout.addEventListener('click', performLogout);
        }
      }

      if (navAuthItem) {
        navAuthItem.href = '#';
        navAuthItem.title = 'Sign out of administrator session';
        navAuthItem.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Logout';
        navAuthItem.addEventListener('click', performLogout);
      }

      // Query /api/auth/me to check token validity and get actual username
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.authenticated && data.admin) {
            const adminNameEl = document.getElementById('header-admin-name');
            if (adminNameEl && data.admin.username) {
              adminNameEl.textContent = data.admin.username;
            }
          } else {
            // Token expired or invalid
            localStorage.removeItem('techbots_admin_token');
          }
        })
        .catch(() => {
          // Network issue or offline - keep cached UI
        });

    } else {
      // Anonymous / Visitor mode
      if (headerSlot && !headerSlot.querySelector('.btn-header-auth')) {
        headerSlot.innerHTML = `
          <a href="login.html" class="btn-header-auth"><i class="fa-solid fa-lock"></i> Admin</a>
        `;
      }

      if (navAuthItem) {
        navAuthItem.href = 'login.html';
        navAuthItem.innerHTML = '<i class="fa-solid fa-lock"></i> Login';
      }
    }
  }

  function init() {
    initMobileNav();
    initLiveClock();
    initAuthNavAndHeader();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
