import { badRequest } from './http.js';

/**
 * Dollars in, whole cents out, without ever touching a float.
 * Accepts 1234, "1234", "$1,234.5", "1234.56", "-12.00".
 */
export function parseMoneyToCents(value, field) {
  if (value === null || value === undefined || value === '') return null;

  // Thousands separators must be grouped properly: "1,250.75" is fine,
  // "12," and "1,2,3" are typos and are refused rather than silently reshaped.
  const text = String(value).trim().replace(/[$\s]/g, '');
  const match = /^(-?)(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw badRequest(`"${field}" must be an amount like 1250 or 1250.75`, { field });

  const [, sign, grouped, frac = ''] = match;
  const whole = grouped.replace(/,/g, '');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw badRequest(`"${field}" is too large`, { field });
  return sign === '-' ? -cents : cents;
}

export function requiredCents(body, field) {
  const cents = parseMoneyToCents(body[field], field);
  if (cents === null) throw badRequest(`"${field}" is required`, { field });
  return cents;
}

/** Returns undefined when the field is absent, null when it is explicitly cleared. */
export function optionalCents(body, field) {
  if (!(field in body)) return undefined;
  return parseMoneyToCents(body[field], field);
}
