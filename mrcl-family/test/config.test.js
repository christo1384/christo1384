import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, DEFAULTS, merge } from '../public/js/config.js';

test('the defaults describe a board that works out of the box', () => {
  assert.equal(DEFAULTS.weekStartsOn, 1);
  assert.deepEqual(DEFAULTS.familyNames, []);
  assert.equal(DEFAULTS.weather.enabled, true);
});

test('calendar addresses are never part of the client config', () => {
  // They are secrets: the server holds them and the pages ask /api/calendars
  // for the list at runtime.
  assert.equal('calendars' in DEFAULTS, false);
  assert.equal(CONFIG.boardTitle, DEFAULTS.boardTitle);
});

test('merge overrides scalars and merges one level of nesting', () => {
  const merged = merge(DEFAULTS, { weekStartsOn: 0, weather: { label: 'Ōtāhuhu' } });
  assert.equal(merged.weekStartsOn, 0);
  assert.equal(merged.weather.label, 'Ōtāhuhu');
  assert.equal(merged.weather.latitude, DEFAULTS.weather.latitude);
  assert.equal(merged.weather.enabled, true);
});

test('merge replaces arrays wholesale and ignores undefined', () => {
  assert.deepEqual(merge(DEFAULTS, { familyNames: ['Lili'] }).familyNames, ['Lili']);
  assert.equal(merge(DEFAULTS, { boardTitle: undefined }).boardTitle, DEFAULTS.boardTitle);
});
