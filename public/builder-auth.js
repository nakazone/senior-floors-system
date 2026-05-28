/* global sessionStorage */
(function () {
  const TOKEN_KEY = 'sf_builder_token';

  window.builderAuth = {
    getToken() {
      return sessionStorage.getItem(TOKEN_KEY);
    },
    setToken(t) {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    },
    async fetch(path, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      const token = this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(path, { ...opts, headers });
      if (r.status === 401) {
        this.setToken(null);
        if (!location.pathname.includes('builder-login')) {
          location.href = 'builder-login.html';
        }
      }
      return r;
    },
    requireAuth() {
      if (!this.getToken() && !location.pathname.includes('builder-login')) {
        location.href = 'builder-login.html';
        return false;
      }
      return true;
    },
  };

  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('loginError');
      err.style.display = 'none';
      try {
        const r = await fetch('/api/builder-auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error || 'Login failed');
        window.builderAuth.setToken(j.data.token);
        location.href = 'builder-portal.html';
      } catch (ex) {
        err.textContent = ex.message || 'Login failed';
        err.style.display = 'block';
      }
    });
  }
})();
