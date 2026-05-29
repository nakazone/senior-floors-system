(function () {
  const params = new URLSearchParams(location.search);

  if (typeof window.sfAttachAddressAutocomplete === 'function') {
    window.sfEnsureCrmAddressAutocomplete?.().then(() => {
      window.sfAttachAddressAutocomplete(document.getElementById('estAddress'), { country: 'us' });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const floor = params.get('floor');
      const sqft = params.get('sqft');
      if (sqft) {
        const inp = document.querySelector('[name=area_sqft]');
        if (inp) inp.value = sqft;
      }
      if (floor) {
        document.querySelectorAll('input[name=svc]').forEach((cb) => {
          const v = (cb.value || '').toLowerCase();
          const f = floor.toLowerCase();
          if (v.includes(f) || f.includes('hardwood') && v.includes('hardwood')) cb.checked = true;
        });
      }
    }, 200);
  });

  document.getElementById('estFiles')?.addEventListener('change', (e) => {
    const prev = document.getElementById('estFilePreview');
    if (!prev) return;
    prev.innerHTML = '';
    [...(e.target.files || [])].slice(0, 5).forEach((f) => {
      const span = document.createElement('span');
      span.className = 'bp-file-chip';
      span.textContent = f.name;
      prev.appendChild(span);
    });
  });

  document.getElementById('estForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData();
    fd.append('project_type', form.project_type.value);
    fd.append('address', (form.address?.value || document.getElementById('estAddress')?.value || '').trim());
    const svcs = [...form.querySelectorAll('input[name=svc]:checked')].map((c) => c.value);
    fd.append('services', JSON.stringify(svcs));
    fd.append('area_sqft', form.area_sqft.value);
    fd.append('desired_start', form.desired_start.value || '');
    fd.append('urgency', form.urgency.value);
    fd.append('notes', form.notes.value || '');
    const files = document.getElementById('estFiles')?.files;
    if (files) {
      for (let i = 0; i < Math.min(5, files.length); i++) {
        fd.append('attachments', files[i]);
      }
    }

    const r = await window.builderAuth.fetch('/api/estimate-requests', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok || !j.success) {
      alert(j.error || 'Could not submit');
      return;
    }
    form.classList.add('hidden');
    document.getElementById('estSuccess').classList.remove('hidden');
    document.getElementById('estRef').textContent = j.data.ref_number;
  });
})();
