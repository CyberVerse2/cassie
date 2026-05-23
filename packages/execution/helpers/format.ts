export function formatDecimal(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const truncated = Math.floor(value * factor) / factor;
  return truncated.toFixed(decimals).replace(/\.?0+$/, "");
}
