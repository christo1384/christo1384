import test from 'node:test';
import assert from 'node:assert/strict';

import { buildForecastUrl, describeWeatherCode, fetchForecast, parseForecast } from '../public/js/weather.js';

const place = { enabled: true, latitude: -36.9442, longitude: 174.8436, timezone: 'Pacific/Auckland' };

test('known WMO codes get a label and an icon', () => {
  assert.deepEqual(describeWeatherCode(0), { label: 'Clear', icon: '☀️' });
  assert.deepEqual(describeWeatherCode(63), { label: 'Rain', icon: '🌧️' });
  assert.deepEqual(describeWeatherCode(999), { label: '—', icon: '·' });
  assert.deepEqual(describeWeatherCode(undefined), { label: '—', icon: '·' });
});

test('buildForecastUrl carries the place, the fields and the range', () => {
  const url = new URL(buildForecastUrl(place, { start: '2026-07-13', end: '2026-07-19' }));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '-36.9442');
  assert.equal(url.searchParams.get('timezone'), 'Pacific/Auckland');
  assert.equal(url.searchParams.get('start_date'), '2026-07-13');
  assert.equal(url.searchParams.get('end_date'), '2026-07-19');
  assert.equal(url.searchParams.get('daily'), 'weather_code,temperature_2m_max,temperature_2m_min');
});

test('buildForecastUrl omits the range when it is not given', () => {
  const url = new URL(buildForecastUrl(place));
  assert.equal(url.searchParams.get('start_date'), null);
});

test('parseForecast keys the days and rounds the temperatures', () => {
  const parsed = parseForecast({
    daily: {
      time: ['2026-07-13', '2026-07-14'],
      weather_code: [3, 63],
      temperature_2m_max: [14.4, 15.6],
      temperature_2m_min: [8.2, 9.9],
    },
  });
  assert.deepEqual(parsed['2026-07-13'], { label: 'Overcast', icon: '☁️', max: 14, min: 8 });
  assert.deepEqual(parsed['2026-07-14'], { label: 'Rain', icon: '🌧️', max: 16, min: 10 });
});

test('parseForecast survives missing and malformed payloads', () => {
  assert.deepEqual(parseForecast({}), {});
  assert.deepEqual(parseForecast(null), {});
  assert.deepEqual(parseForecast({ daily: { time: null } }), {});
  const partial = parseForecast({ daily: { time: ['2026-07-13'] } });
  assert.deepEqual(partial['2026-07-13'], { label: '—', icon: '·', max: null, min: null });
});

test('fetchForecast returns {} when weather is switched off or unlocated', async () => {
  const boom = () => {
    throw new Error('should not be called');
  };
  assert.deepEqual(await fetchForecast({ ...place, enabled: false }, {}, { fetchImpl: boom }), {});
  assert.deepEqual(await fetchForecast({ enabled: true }, {}, { fetchImpl: boom }), {});
  assert.deepEqual(await fetchForecast(undefined, {}, { fetchImpl: boom }), {});
});

test('fetchForecast swallows a network error and a bad status', async () => {
  const rejects = async () => {
    throw new Error('offline');
  };
  assert.deepEqual(await fetchForecast(place, {}, { fetchImpl: rejects }), {});

  const notOk = async () => ({ ok: false });
  assert.deepEqual(await fetchForecast(place, {}, { fetchImpl: notOk }), {});
});

test('fetchForecast parses a good response', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ daily: { time: ['2026-07-13'], weather_code: [0], temperature_2m_max: [18], temperature_2m_min: [10] } }),
  });
  const result = await fetchForecast(place, { start: '2026-07-13', end: '2026-07-19' }, { fetchImpl });
  assert.deepEqual(result['2026-07-13'], { label: 'Clear', icon: '☀️', max: 18, min: 10 });
});
