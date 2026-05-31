export function formatDecimal(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const truncated = Math.floor(value * factor) / factor;
  return trimDecimalZeros(truncated.toFixed(decimals));
}

export function formatSignificantDecimal(value: number, significantFigures: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Decimal value must be finite.");
  }
  if (!Number.isInteger(significantFigures) || significantFigures <= 0) {
    throw new Error("Significant figures must be a positive integer.");
  }

  return trimDecimalZeros(expandExponential(Number(value.toPrecision(significantFigures)).toString()));
}

function expandExponential(value: string): string {
  if (!value.toLowerCase().includes("e")) return value;

  const [coefficient, exponentText] = value.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!coefficient || !Number.isInteger(exponent)) return value;

  const sign = coefficient.startsWith("-") ? "-" : "";
  const unsignedCoefficient = sign ? coefficient.slice(1) : coefficient;
  const [whole, fraction = ""] = unsignedCoefficient.split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function trimDecimalZeros(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
