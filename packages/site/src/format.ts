import type { Amount, Figure } from "@usagekit/views";

/** Exact display parts of a decimal cents text such as "1800.02" or "150.0000". No numbers. */
export type DollarParts = { negative: boolean; dollars: string; cents: string; subcents: string };

export function dollarParts(centsText: string): DollarParts {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(centsText);
  if (!match) throw Error(`Not a cents amount: ${centsText}`);
  const [, sign = "", whole = "0", fraction = ""] = match;
  const padded = whole.padStart(3, "0");
  return {
    negative: sign === "-" && /[1-9]/.test(whole + fraction),
    dollars: groupDigits(padded.slice(0, -2).replace(/^0+(?=\d)/, "")),
    cents: padded.slice(-2),
    subcents: fraction.padEnd(4, "0"),
  };
}

/** "$18.00": dollars and whole cents. Pair with subcents wherever exactness matters. */
export function usd(centsText: string): string {
  const { negative, dollars, cents } = dollarParts(centsText);
  return `${negative ? "−" : ""}$${dollars}.${cents}`;
}

/** Significant digits past the cent: "02" for 1800.02 cents, "" for 150.0000. */
export const fineDigits = (subcents: string): string => subcents.replace(/0+$/, "");

/** "$18.0002": every significant digit of the exact amount, trailing zeros trimmed. */
export function usdExact(centsText: string): string {
  const { negative, dollars, cents, subcents } = dollarParts(centsText);
  return `${negative ? "−" : ""}$${dollars}.${cents}${fineDigits(subcents)}`;
}

/** Thousands separators for an exact integer or decimal text. */
export function groupDigits(text: string): string {
  const [whole = "", fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Display text for any figure. Unknown and unavailable are never shown as zero. */
export function figureText(figure: Figure | undefined): string {
  if (!figure || figure === "unavailable") return "Unavailable";
  if (figure.certainty === "unknown") return "Unknown";
  return figure.unit === "cents" ? usdExact(figure.text) : groupDigits(figure.text);
}

export const isKnown = (figure: Figure | undefined): figure is Amount =>
  !!figure && figure !== "unavailable" && figure.certainty !== "unknown";

export const certaintyLabel = {
  measured: "Measured",
  estimated: "Estimated",
  unknown: "Unknown",
} as const;

/** "12:04:07" from an ISO instant, in UTC, without the viewer's locale or time zone. */
export const utcTime = (iso: string): string => iso.slice(11, 19);

export const providerLabel = (provider: string) =>
  provider === "language" ? "Language model" : provider === "search" ? "Search API" : provider;
