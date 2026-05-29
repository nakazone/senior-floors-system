/* global crmNotify */
(function () {
  function isPortal() {
    return !!window.builderAuth?.getToken?.();
  }
  const $ = (id) => document.getElementById(id);

  const FLOOR_PILLS = [
    { key: '', label: 'All' },
    { key: 'hardwood', label: 'Hardwood' },
    { key: 'engineered', label: 'Engineered' },
    { key: 'lvp', label: 'LVP' },
    { key: 'tile', label: 'Tile' },
    { key: 'laminate', label: 'Laminate' },
    { key: 'custom', label: 'Custom' },
  ];

  let portalItems = [];
  let portalFilter = { floor: '', region: '', q: '' };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchList(url) {
    const r = isPortal()
      ? await window.builderAuth.fetch(url)
      : await fetch(url, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || 'Error');
    return j.data || [];
  }

  function estimateUrl(item) {
    const params = new URLSearchParams();
    if (item.floor_type) params.set('floor', item.floor_type);
    if (item.area_sqft) params.set('sqft', item.area_sqft);
    params.set('from_gallery', String(item.id));
    return `builder-estimate-request.html?${params.toString()}`;
  }

  function openLightbox(item) {
    let lb = document.getElementById('bpGalleryLightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'bpGalleryLightbox';
      lb.className = 'bp-lightbox';
      document.body.appendChild(lb);
    }
    lb.classList.add('open');
    lb.innerHTML = '<p class="bp-muted" style="padding:24px">Loading...</p>';

    const load = async () => {
      const r = isPortal()
        ? await window.builderAuth.fetch(`/api/gallery/partner/${item.id}`)
        : await fetch(`/api/gallery/${item.id}`, { credentials: 'include' });
      const j = await r.json();
      if (!j.success) {
        lb.innerHTML = '<p>Error loading gallery.</p>';
        return;
      }
      const g = j.data.project;
      const photos = j.data.photos || [];
      const byPhase = { before: [], during: [], after: [] };
      photos.forEach((p) => {
        const ph = ['before', 'during', 'after'].includes(p.phase) ? p.phase : 'after';
        byPhase[ph].push(p);
      });
      const before = byPhase.before[0]?.url;
      const after = byPhase.after[0]?.url || byPhase.during[0]?.url;
      const hasCompare = before && after;

      let compareBlock = '';
      if (hasCompare) {
        compareBlock = `<div class="bp-ba-slider" id="baSlider">
          <img src="${escapeHtml(before)}" alt="Before" class="bp-ba-slider__before" />
          <div class="bp-ba-slider__after-wrap" style="width:50%">
            <img src="${escapeHtml(after)}" alt="After" class="bp-ba-slider__after" />
          </div>
          <input type="range" min="0" max="100" value="50" class="bp-ba-slider__input" id="baRange" />
        </div>`;
      }

      const grid = photos.length
        ? `<div class="bp-photo-grid" style="margin-top:12px">${photos
            .map(
              (p) =>
                `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(p.url)}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px" /></a>`
            )
            .join('')}</div>`
        : '';

      lb.innerHTML = `
        <div class="bp-lightbox__inner">
          <button type="button" class="bp-lightbox__close" id="lbClose">&times;</button>
          <h2 class="bp-title">${escapeHtml(g.title)}</h2>
          <p class="bp-muted">${escapeHtml(g.floor_type || '')} — ${g.area_sqft ? g.area_sqft + ' sq ft' : ''} — ${escapeHtml(g.region || '')}</p>
          <p style="font-size:14px;margin:12px 0">${escapeHtml(g.description || '')}</p>
          ${compareBlock}
          ${grid}
          <a href="${estimateUrl(item)}" class="bp-btn-tan" style="display:inline-block;margin-top:16px;text-decoration:none">Request similar estimate</a>
        </div>`;
      document.getElementById('lbClose')?.addEventListener('click', () => lb.classList.remove('open'));
      lb.addEventListener('click', (e) => {
        if (e.target === lb) lb.classList.remove('open');
      });
      const range = document.getElementById('baRange');
      const wrap = document.querySelector('.bp-ba-slider__after-wrap');
      if (range && wrap) {
        range.addEventListener('input', () => {
          wrap.style.width = `${range.value}%`;
        });
      }
    };
    load();
  }

  function renderPortalGrid(items, host) {
    if (!items.length) {
      host.innerHTML = '<p class="bp-card">No projects in the gallery yet. Check back soon for inspiration.</p>';
      return;
    }
    host.innerHTML = items
      .map((g) => {
        const img = g.cover_after || g.cover_url || g.cover_before || '';
        const ba = g.cover_before && g.cover_after;
        return `<article class="bp-gallery-card bp-gallery-card--click" data-id="${g.id}" tabindex="0">
          <div class="bp-gallery-card__img" style="background-image:url('${escapeHtml(img)}')">
            ${ba ? '<span class="bp-gallery-card__ba-tag">Before/After</span>' : ''}
          </div>
          <div class="bp-gallery-card__body">
            <span class="bp-badge bp-badge--${g.status === 'featured' ? 'active' : 'pending'}">${escapeHtml(g.status)}</span>
            <h3>${escapeHtml(g.title)}</h3>
            <p class="bp-muted">${escapeHtml(g.floor_type || '')} — ${g.area_sqft ? g.area_sqft + ' sq ft' : ''} — ${escapeHtml(g.region || '')}</p>
          </div>
        </article>`;
      })
      .join('');
    host.querySelectorAll('.bp-gallery-card--click').forEach((card) => {
      const open = () => {
        const id = parseInt(card.dataset.id, 10);
        const item = portalItems.find((x) => x.id === id);
        if (item) openLightbox(item);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open();
      });
    });
  }

  function applyPortalFilters() {
    let list = portalItems;
    if (portalFilter.floor) {
      const f = portalFilter.floor.toLowerCase();
      list = list.filter((g) => String(g.floor_type || '').toLowerCase().includes(f));
    }
    if (portalFilter.region) {
      list = list.filter((g) => String(g.region || '') === portalFilter.region);
    }
    renderPortalGrid(list, $('pg'));
  }

  async function loadPortalList() {
    const params = new URLSearchParams();
    if (portalFilter.q) params.set('q', portalFilter.q);
    const url = `/api/gallery/partner${params.toString() ? `?${params}` : ''}`;
    portalItems = await fetchList(url);
    const regions = [...new Set(portalItems.map((g) => g.region).filter(Boolean))].sort();
    const regSel = $('filterRegion');
    if (regSel && regSel.options.length <= 1) {
      regions.forEach((r) => {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = r;
        regSel.appendChild(o);
      });
    }
    applyPortalFilters();
  }

  function renderGrid(items, host, admin) {
    if (!items.length) {
      host.innerHTML = '<p class="bp-card">No gallery projects.</p>';
      return;
    }
    host.innerHTML = items
      .map(
        (g) => `<article class="bp-gallery-card" data-id="${g.id}">
          <div class="bp-gallery-card__img" style="background-image:url('${escapeHtml(g.cover_url || '')}')"></div>
          <div class="bp-gallery-card__body">
            <span class="bp-badge bp-badge--${g.status === 'featured' ? 'active' : 'pending'}">${escapeHtml(g.status)}</span>
            <h3>${escapeHtml(g.title)}</h3>
            <p class="bp-muted">${escapeHtml(g.floor_type || '')} — ${g.area_sqft ? g.area_sqft + ' sq ft' : ''}</p>
            ${admin ? `<button type="button" class="bp-btn-tan bp-btn-sm" data-edit="${g.id}">Edit</button>` : ''}
          </div>
        </article>`
      )
      .join('');
  }

  async function openEdit(id) {
    const r = await fetch(`/api/gallery/${id}`, { credentials: 'include' });
    const j = await r.json();
    if (!j.success) return;
    const g = j.data.project;
    const photos = j.data.photos || [];
    $('galleryModal').classList.add('open');
    $('modalContent').innerHTML = `
      <h2 class="bp-title">${escapeHtml(g.title)}</h2>
      <form id="galleryForm" class="bp-form-grid">
        <div class="bp-form-full"><label>Title</label><input name="title" value="${escapeHtml(g.title)}" /></div>
        <div class="bp-form-full"><label>Description</label><textarea name="description" rows="3">${escapeHtml(g.description || '')}</textarea></div>
        <div><label>Floor type</label><input name="floor_type" value="${escapeHtml(g.floor_type || '')}" /></div>
        <div><label>Region</label><input name="region" value="${escapeHtml(g.region || '')}" /></div>
        <div><label>Area sqft</label><input name="area_sqft" type="number" value="${g.area_sqft || ''}" /></div>
        <div><label>Status</label><select name="status"><option value="draft">Draft</option><option value="published">Published</option><option value="featured">Featured</option></select></div>
        <div class="bp-form-full"><label>Upload photo</label><input type="file" id="galleryPhotoFile" accept="image/*" /><select id="galleryPhotoPhase"><option value="before">Before</option><option value="during">During</option><option value="after" selected>After</option></select><button type="button" class="bp-btn-tan" id="btnUploadPhoto">Upload</button></div>
        <div class="bp-form-full bp-photo-grid">${photos.map((p) => `<img src="${escapeHtml(p.url)}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:6px" />`).join('')}</div>
        <div class="bp-form-full"><button type="submit" class="bp-btn-tan">Save</button></div>
      </form>`;
    $('galleryForm').querySelector('[name=status]').value = g.status || 'draft';
    $('galleryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.area_sqft = body.area_sqft ? Number(body.area_sqft) : null;
      await fetch(`/api/gallery/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      crmNotify('Saved.', 'success');
      $('galleryModal').classList.remove('open');
      loadAdmin();
    });
    $('btnUploadPhoto')?.addEventListener('click', async () => {
      const file = $('galleryPhotoFile').files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('phase', $('galleryPhotoPhase')?.value || 'after');
      const ur = await fetch(`/api/gallery/${id}/photos`, { method: 'POST', credentials: 'include', body: fd });
      if (ur.ok) {
        crmNotify('Photo uploaded.', 'success');
        openEdit(id);
      }
    });
  }

  async function loadAdmin() {
    const st = $('filterStatus').value;
    const url = st ? `/api/gallery?status=${encodeURIComponent(st)}` : '/api/gallery';
    const items = await fetchList(url);
    renderGrid(items, $('galleryGrid'), true);
    $('galleryGrid').querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => openEdit(b.dataset.edit));
    });
  }

  async function loadPortal() {
    $('adminShell')?.classList.add('hidden');
    $('portalShell')?.classList.remove('hidden');
    const host = $('portalGalleryRoot');
    host.innerHTML = `
      <div id="bpPortalHeader"></div>
      <h1 class="bp-title">Project gallery</h1>
      <p class="bp-muted">Inspiration from completed Senior Floors work.</p>
      <div class="bp-gallery-toolbar">
        <input type="search" id="gallerySearch" placeholder="Search projects..." class="bp-gallery-search" />
        <select id="filterRegion"><option value="">All regions</option></select>
      </div>
      <div class="bp-pills" id="floorPills"></div>
      <div class="bp-gallery-grid" id="pg"></div>`;

    $('floorPills').innerHTML = FLOOR_PILLS.map(
      (p) =>
        `<button type="button" class="bp-pill${portalFilter.floor === p.key ? ' active' : ''}" data-floor="${escapeHtml(p.key)}">${escapeHtml(p.label)}</button>`
    ).join('');
    $('floorPills').querySelectorAll('.bp-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        portalFilter.floor = btn.dataset.floor || '';
        $('floorPills').querySelectorAll('.bp-pill').forEach((b) => b.classList.toggle('active', b === btn));
        applyPortalFilters();
      });
    });

    let searchTimer;
    $('gallerySearch')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        portalFilter.q = e.target.value.trim();
        loadPortalList();
      }, 300);
    });
    $('filterRegion')?.addEventListener('change', (e) => {
      portalFilter.region = e.target.value;
      applyPortalFilters();
    });

    await loadPortalList();
  }

  async function init() {
    if (isPortal()) {
      if (!window.builderAuth.requireAuth()) return;
      await loadPortal();
      return;
    }
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    $('filterStatus')?.addEventListener('change', loadAdmin);
    $('btnNewGallery')?.addEventListener('click', async () => {
      const r = await fetch('/api/gallery', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New gallery project', status: 'draft' }),
      });
      const j = await r.json();
      if (j.success) openEdit(j.data.id);
    });
    await loadAdmin();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, isPortal() ? 120 : 0);
  });
})();
