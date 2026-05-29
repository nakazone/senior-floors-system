(function () {
  if (!window.builderAuth.requireAuth()) return;

  const sel = document.getElementById('calcService');
  const range = document.getElementById('calcArea');
  const num = document.getElementById('calcAreaNum');
  const label = document.getElementById('areaLabel');

  function syncArea(v) {
    range.value = v;
    num.value = v;
    label.textContent = v;
  }

  range.addEventListener('input', () => syncArea(range.value));
  num.addEventListener('change', () => syncArea(num.value));

  async function loadServices() {
    const r = await window.builderAuth.fetch('/api/pricing/partner');
    const j = await r.json();
    (j.data || [])
      .filter((s) => !s.is_locked)
      .forEach((s) => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = `${s.name} (${s.unit}) – $${s.partner_price}`;
        sel.appendChild(o);
      });
  }

  document.getElementById('btnCalc').addEventListener('click', async () => {
    const r = await window.builderAuth.fetch('/api/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: parseInt(sel.value, 10),
        area_sqft: parseInt(num.value, 10),
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Error');
      return;
    }
    const d = j.data;
    const fmt = (n) =>
      '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    document.getElementById('calcResult').classList.remove('hidden');
    document.getElementById('calcRange').textContent = `${fmt(d.estimate_low_discounted)} – ${fmt(d.estimate_high_discounted)}`;
    document.getElementById('calcVol').textContent =
      d.volume_discount_pct > 0
        ? `Includes ${d.volume_discount_pct}% volume discount on partner rate`
        : `Based on partner rate ${fmt(d.rate)}/${d.unit}`;
  });

  loadServices();
})();
