import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, DEFAULTS, hasCalendars, merge } from '../public/js/config.js';

test('the defaults describe a board that works out of the box', () => {
  assert.equal(DEFAULTS.weekStartsOn, 1);
  assert.deepEqual(DEFAULTS.calendars, []);
  assert.deepEqual(DEFAULTS.familyNames, []);
  assert.equal(DEFAULTS.weather.enabled, true);
});

test('nothing has to be configured for the board to function', () => {
  // The store lives on the same site, so an unconfigured deploy is simply an
  // empty board rather than a broken one.
  assert.equal(CONFIG.boardTitle, DEFAULTS.boardTitle);
  assert.equal(hasCalendars(DEFAULTS), false);
});

test('hasCalendars reports whether anything feeds the board automatically', () => {
  assert.equal(hasCalendars({ calendars: ['https://e/a.ics'] }), true);
  assert.equal(hasCalendars({ calendars: [] }), false);
  assert.equal(hasCalendars({}), false);
  assert.equal(hasCalendars({ calendars: 'not a list' }), false);
});

test('merge overrides scalars and merges one level of nesting', () => {
  const merged = merge(DEFAULTS, { weekStartsOn: 0, weather: { label: 'Ōtāhuhu' } });
  assert.equal(merged.weekStartsOn, 0);
  assert.equal(merged.weather.label, 'Ōtāhuhu');
  assert.equal(merged.weather.latitude, DEFAULTS.weather.latitude);
  assert.equal(merged.weather.enabled, true);
});

test('merge replaces arrays wholesale and ignores undefined', () => {
  assert.deepEqual(merge(DEFAULTS, { calendars: ['a', 'b'] }).calendars, ['a', 'b']);
  assert.deepEqual(merge(DEFAULTS, { familyNames: ['Lili'] }).familyNames, ['Lili']);
  assert.equal(merge(DEFAULTS, { boardTitle: undefined }).boardTitle, DEFAULTS.boardTitle);
});
