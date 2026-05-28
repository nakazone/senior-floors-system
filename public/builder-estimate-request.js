(function () {
  if (!window.builderAuth.requireAuth()) return;

  if (typeof window.sfAttachAddressAutocomplete === 'function') {
    window.sfEnsureCrmAddressAutocomplete?.().then(() => {
      window.sfAttachAddressAutocomplete(document.getElementById('estAddress'), { country: 'us' });
    });
  }

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
    const file = form.attachment.files[0];
    if (file) fd.append('attachment', file);

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
