/**
 * Money helpers. Integer cents internally, PayPal wire format ({currency, value "12.34"}) outside.
 * Never use floats for arithmetic on Money; go through these helpers.
 */
import type { Money } from "./contracts";

const VALUE_RE = /^(-)?(\d*)(?:\.(\d*))?$/;

function parseToCents(raw: string): number {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  const m = VALUE_RE.exec(cleaned);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new Error(`Not a money amount: "${raw}"`);
  }
  const negative = m[1] === "-";
  const whole = m[2] === "" ? 0 : Number.parseInt(m[2], 10);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = whole * 100 + Number.parseInt(frac.slice(0, 2), 10);
  // Round half up on the third decimal place.
  if (Number.parseInt(frac[2], 10) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) throw new Error(`Money amount out of range: "${raw}"`);
  return negative ? -cents : cents;
}

/** Build a Money from "12.3", "12", 12.3 or "$1,200.00". Rounds half up to cents. */
export function money(value: string | number, currency = "USD"): Money {
  let cents: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Not a money amount: ${value}`);
    cents = Math.round(value * 100 + (value >= 0 ? 1e-9 : -1e-9));
  } else {
    cents = parseToCents(value);
  }
  return fromCents(cents, currency);
}

/** Integer cents for a Money value (sign preserved). */
export function toCents(m: Money): number {
  return parseToCents(m.value);
}

export function fromCents(cents: number, currency = "USD"): Money {
  if (!Number.isInteger(cents)) throw new Error(`Cents must be an integer, got ${cents}`);
  const abs = Math.abs(cents);
  const value = `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return { currency: currency.toUpperCase(), value };
}

export function zeroMoney(currency = "USD"): Money {
  return fromCents(0, currency);
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return fromCents(toCents(a) + toCents(b), a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return fromCents(toCents(a) - toCents(b), a.currency);
}

export function cmpMoney(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  const d = toCents(a) - toCents(b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

export function sumMoney(list: Money[], currency = "USD"): Money {
  let total = 0;
  for (const m of list) {
    if (m.currency.toUpperCase() !== currency.toUpperCase()) {
      throw new Error(`Currency mismatch: ${m.currency} vs ${currency}`);
    }
    total += toCents(m);
  }
  return fromCents(total, currency);
}

/** Multiply by an integer count (e.g. unit price x quantity). */
export function mulMoney(m: Money, count: number): Money {
  if (!Number.isInteger(count)) throw new Error(`mulMoney needs an integer count, got ${count}`);
  return fromCents(toCents(m) * count, m.currency);
}

export function minMoney(a: Money, b: Money): Money {
  return cmpMoney(a, b) <= 0 ? a : b;
}

export function maxMoney(a: Money, b: Money): Money {
  return cmpMoney(a, b) >= 0 ? a : b;
}

export function isZero(m: Money): boolean {
  return toCents(m) === 0;
}

const SYMBOLS: Record<string, string> = { USD: "$", CAD: "CA$", AUD: "A$", EUR: "€", GBP: "£", JPY: "¥" };

/** "$42.18", "-$5.00", "$1,250.00", or "12.00 CHF" for currencies without a symbol. */
export function formatMoney(m: Money): string {
  const cents = toCents(m);
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${whole}.${String(abs % 100).padStart(2, "0")}`;
  const sign = cents < 0 ? "-" : "";
  const symbol = SYMBOLS[m.currency.toUpperCase()];
  return symbol ? `${sign}${symbol}${body}` : `${sign}${body} ${m.currency.toUpperCase()}`;
}
