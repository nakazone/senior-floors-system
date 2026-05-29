/** Shared partner pricing calculation for builder portal. */

export function volumeDiscountPct(areaSqft) {
  const area = Number(areaSqft) || 0;
  if (area >= 5000) return 15;
  if (area >= 2500) return 12;
  if (area >= 1000) return 8;
  if (area >= 500) return 5;
  return 0;
}

export function calculateLine(svc, areaSqft) {
  const area = Math.max(0, parseInt(String(areaSqft), 10) || 0);
  const rate = Number(svc.partner_price) || 0;
  const low = Math.round(area * rate * 0.95 * 100) / 100;
  const high = Math.round(area * rate * 1.1 * 100) / 100;
  const volumePct = volumeDiscountPct(area);
  return {
    service_id: svc.id,
    service: svc.name,
    unit: svc.unit,
    rate,
    area_sqft: area,
    estimate_low: low,
    estimate_high: high,
    volume_discount_pct: volumePct,
    estimate_low_discounted: Math.round(low * (1 - volumePct / 100) * 100) / 100,
    estimate_high_discounted: Math.round(high * (1 - volumePct / 100) * 100) / 100,
    public_savings_low: Math.round(area * ((Number(svc.price_max) || rate) - rate) * 100) / 100,
  };
}

export function sumCalculationLines(lines) {
  const totals = lines.reduce(
    (acc, line) => {
      acc.estimate_low_discounted += line.estimate_low_discounted || 0;
      acc.estimate_high_discounted += line.estimate_high_discounted || 0;
      acc.area_sqft += line.area_sqft || 0;
      return acc;
    },
    { estimate_low_discounted: 0, estimate_high_discounted: 0, area_sqft: 0 }
  );
  totals.estimate_low_discounted = Math.round(totals.estimate_low_discounted * 100) / 100;
  totals.estimate_high_discounted = Math.round(totals.estimate_high_discounted * 100) / 100;
  return totals;
}
