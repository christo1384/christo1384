import { badRequest } from './http.js';

const trim = (v) => (typeof v === 'string' ? v.trim() : v);

export function requiredText(body, field, { max = 500 } = {}) {
  const value = trim(body[field]);
  if (typeof value !== 'string' || value === '') {
    throw badRequest(`"${field}" is required`, { field });
  }
  if (value.length > max) throw badRequest(`"${field}" must be ${max} characters or fewer`, { field });
  return value;
}

export function optionalText(body, field, { max = 5000 } = {}) {
  if (!(field in body)) return undefined;
  const value = trim(body[field]);
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`"${field}" must be text`, { field });
  if (value.length > max) throw badRequest(`"${field}" must be ${max} characters or fewer`, { field });
  return value;
}

export function optionalEnum(body, field, allowed) {
  if (!(field in body)) return undefined;
  const value = trim(body[field]);
  if (!allowed.includes(value)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`, { field, allowed });
  }
  return value;
}

/** Accepts an ISO date (YYYY-MM-DD); empty string or null clears the field. */
export function optionalDate(body, field) {
  if (!(field in body)) return undefined;
  const value = trim(body[field]);
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`"${field}" must be a date formatted YYYY-MM-DD`, { field });
  }
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    throw badRequest(`"${field}" is not a real calendar date`, { field });
  }
  return value;
}

export function optionalId(body, field) {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) throw badRequest(`"${field}" must be a record id`, { field });
  return num;
}

export function pathId(params, field = 'id') {
  const num = Number(params[field]);
  if (!Number.isInteger(num) || num < 1) throw badRequest('Invalid id in URL');
  return num;
}

/** Builds "col = ?, col = ?" plus values, skipping fields left undefined. */
export function buildPatch(fields) {
  const columns = [];
  const values = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    columns.push(`${column} = ?`);
    values.push(value);
  }
  return { columns, values };
}
