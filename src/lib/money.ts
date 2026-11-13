// Whole rupees without decimals, otherwise exactly two (sale prices like 1039.20 must not show as 1039.2).
export function formatINR(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return n.toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
