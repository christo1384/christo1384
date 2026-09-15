import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, DEFAULTS, isConfigured, merge, missingFirebaseKeys } from '../public/js/config.js';

const complete = { apiKey: 'k', authDomain: 'a', projectId: 'p', appId: 'x' };

test('the defaults are sane for a board that has not been configured yet', () => {
  assert.equal(DEFAULTS.weekStartsOn, 1);
  assert.equal(DEFAULTS.firebase, null);
  assert.deepEqual(DEFAULTS.calendars, []);
  assert.equal(isConfigured(DEFAULTS), false);
});

test('CONFIG falls back to the defaults outside a browser', () => {
  assert.equal(CONFIG.boardTitle, DEFAULTS.boardTitle);
  assert.equal(isConfigured(), false);
});

test('merge overrides scalars and merges one level of nesting', () => {
  const merged = merge(DEFAULTS, { weekStartsOn: 0, weather: { label: 'Ōtāhuhu' } });
  assert.equal(merged.weekStartsOn, 0);
  assert.equal(merged.weather.label, 'Ōtāhuhu');
  // Untouched nested keys survive rather than being wiped by the override.
  assert.equal(merged.weather.latitude, DEFAULTS.weather.latitude);
  assert.equal(merged.weather.enabled, true);
});

test('merge replaces arrays wholesale and ignores undefined', () => {
  assert.deepEqual(merge(DEFAULTS, { calendars: ['a', 'b'] }).calendars, ['a', 'b']);
  assert.equal(merge(DEFAULTS, { boardTitle: undefined }).boardTitle, DEFAULTS.boardTitle);
});

test('isConfigured needs every required Firebase key', () => {
  assert.equal(isConfigured({ firebase: complete }), true);
  assert.equal(isConfigured({ firebase: { ...complete, appId: '' } }), false);
  assert.equal(isConfigured({ firebase: {} }), false);
  assert.equal(isConfigured({ firebase: 'nope' }), false);
  assert.equal(isConfigured({}), false);
});

test('missingFirebaseKeys names what still has to be set', () => {
  assert.deepEqual(missingFirebaseKeys({ firebase: complete }), []);
  assert.deepEqual(missingFirebaseKeys({ firebase: { apiKey: 'k' } }), ['authDomain', 'projectId', 'appId']);
  assert.deepEqual(missingFirebaseKeys({}), ['apiKey', 'authDomain', 'projectId', 'appId']);
});
