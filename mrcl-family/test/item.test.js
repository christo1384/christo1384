import test from 'node:test';
import assert from 'node:assert/strict';

import { itemSubtitle, MAX_TITLE, MAX_WHO, normaliseItem, validateItem } from '../public/js/item.js';

test('normaliseItem trims, collapses whitespace and truncates', () => {
  const value = normaliseItem({ title: '  Soccer   practice  ', who: ' Ruby ', category: 'sport', date: '2026-07-16' });
  assert.equal(value.title, 'Soccer practice');
  assert.equal(value.who, 'Ruby');
  assert.equal(normaliseItem({ title: 'x'.repeat(500) }).title.length, MAX_TITLE);
  assert.equal(normaliseItem({ who: 'y'.repeat(500) }).who.length, MAX_WHO);
});

test('normaliseItem falls back to a safe category', () => {
  assert.equal(normaliseItem({ category: 'not-a-category' }).category, 'appointment');
  assert.equal(normaliseItem({ category: 'dinner' }).category, 'dinner');
  assert.equal(normaliseItem({}).category, 'appointment');
});

test('normaliseItem keeps only well-formed times', () => {
  assert.equal(normaliseItem({ time: '16:30' }).time, '16:30');
  assert.equal(normaliseItem({ time: '09:05' }).time, '09:05');
  assert.equal(normaliseItem({ time: '25:00' }).time, '');
  assert.equal(normaliseItem({ time: '9:5' }).time, '');
  assert.equal(normaliseItem({ time: '' }).time, '');
  assert.equal(normaliseItem({}).time, '');
});

test('normaliseItem coerces the booleans', () => {
  assert.equal(normaliseItem({ annual: 'yes' }).annual, true);
  assert.equal(normaliseItem({}).annual, false);
  assert.equal(normaliseItem({ done: 1 }).done, true);
});

test('a good item validates', () => {
  const result = validateItem({ title: 'Soccer', category: 'sport', date: '2026-07-16', time: '16:00' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.title, 'Soccer');
});

test('validateItem reports each problem against its field', () => {
  const result = validateItem({ title: '   ', category: 'nope', date: '2026-02-31', time: '99:99' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.field).sort(), ['category', 'date', 'time', 'title']);
});

test('an empty time is allowed but a malformed one is not', () => {
  assert.equal(validateItem({ title: 'Bins', category: 'chore', date: '2026-07-16', time: '' }).ok, true);
  assert.equal(validateItem({ title: 'Bins', category: 'chore', date: '2026-07-16', time: 'half four' }).ok, false);
});

test('validateItem still returns the cleaned value when it fails', () => {
  const result = validateItem({ title: '  Bins  ', category: 'chore', date: 'rubbish' });
  assert.equal(result.ok, false);
  assert.equal(result.value.title, 'Bins');
});

test('itemSubtitle joins only the parts that are present', () => {
  assert.equal(itemSubtitle({ who: 'Ruby' }), 'Ruby');
  assert.equal(itemSubtitle({ who: 'Ruby', annualYears: 9 }), 'Ruby · turns 9');
  assert.equal(itemSubtitle({ location: 'Main St' }), 'Main St');
  assert.equal(itemSubtitle({}), '');
});
