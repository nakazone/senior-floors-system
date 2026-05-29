/* global crmNotify */
(function () {
  function isPortal() {
    return !!window.builderAuth?.getToken?.();
  }
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function fetchList(url) {
    const r = isPortal
      ? await window.builderAuth.fetch(url)
      : await fetch(url, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || 'Error');
    return j.data || [];
  }

  function renderGrid(items, host, admin) {
    if (!items.length) {
      host.innerHTML = '<p class="bp-card">Nenhum projeto na galeria.</p>';
      return;
    }
    host.innerHTML = items
      .map(
        (g) => `<article class="bp-gallery-card" data-id="${g.id}">
          <div class="bp-gallery-card__img" style="background-image:url('${escapeHtml(g.cover_url || '')}')"></div>
          <div class="bp-gallery-card__body">
            <span class="bp-badge bp-badge--${g.status === 'featured' ? 'active' : 'pending'}">${escapeHtml(g.status)}</span>
            <h3>${escapeHtml(g.title)}</h3>
            <p class="bp-muted">${escapeHtml(g.floor_type || '')} · ${g.area_sqft ? g.area_sqft + ' sqft' : ''} · ${escapeHtml(g.region || '')}</p>
            ${admin ? `<button type="button" class="bp-btn-tan bp-btn-sm" data-edit="${g.id}">Editar</button>` : `<a href="builder-messages.html?gallery_ref=${g.id}" class="bp-btn-tan bp-btn-sm" style="text-decoration:none;display:inline-block;margin-top:8px">Use as reference</a>`}
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
        <div class="bp-form-full"><label>Título</label><input name="title" value="${escapeHtml(g.title)}" /></div>
        <div class="bp-form-full"><label>Descrição</label><textarea name="description" rows="3">${escapeHtml(g.description || '')}</textarea></div>
        <div><label>Tipo piso</label><input name="floor_type" value="${escapeHtml(g.floor_type || '')}" /></div>
        <div><label>Região</label><input name="region" value="${escapeHtml(g.region || '')}" /></div>
        <div><label>Área sqft</label><input name="area_sqft" type="number" value="${g.area_sqft || ''}" /></div>
        <div><label>Status</label><select name="status"><option value="draft">Rascunho</option><option value="published">Publicado</option><option value="featured">Destaque</option></select></div>
        <div class="bp-form-full"><label>Upload foto</label><input type="file" id="galleryPhotoFile" accept="image/*" /><button type="button" class="bp-btn-tan" id="btnUploadPhoto">Upload</button></div>
        <div class="bp-form-full bp-photo-grid">${photos.map((p) => `<img src="${escapeHtml(p.url)}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:6px" />`).join('')}</div>
        <div class="bp-form-full"><button type="submit" class="bp-btn-tan">Guardar</button></div>
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
      crmNotify('Guardado.', 'success');
      $('galleryModal').classList.remove('open');
      loadAdmin();
    });
    $('btnUploadPhoto')?.addEventListener('click', async () => {
      const file = $('galleryPhotoFile').files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const ur = await fetch(`/api/gallery/${id}/photos`, { method: 'POST', credentials: 'include', body: fd });
      if (ur.ok) {
        crmNotify('Foto enviada.', 'success');
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
    $('adminShell').classList.add('hidden');
    $('portalShell').classList.remove('hidden');
    const items = await fetchList('/api/gallery/partner');
    const host = $('portalGalleryRoot');
    host.innerHTML = '<h1 class="bp-title">Project gallery</h1><p class="bp-muted">Inspiration from completed Senior Floors work.</p><div class="bp-gallery-grid" id="pg"></div>';
    renderGrid(items, $('pg'), false);
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

  init();
})();
