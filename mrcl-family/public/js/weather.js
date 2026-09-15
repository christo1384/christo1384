// The WEATHER strip along the bottom of the board.
//
// Open-Meteo needs no API key and no account, so there is nothing here for
// anyone to set up or for a key rotation to break. If the request fails the
// strip simply hides itself — a fridge board is not the place for an error.

const WMO_CODES = {
  0: ['Clear', '☀️'],
  1: ['Mainly clear', '🌤️'],
  2: ['Partly cloudy', '⛅'],
  3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'],
  48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'],
  53: ['Drizzle', '🌦️'],
  55: ['Heavy drizzle', '🌦️'],
  56: ['Freezing drizzle', '🌧️'],
  57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'],
  63: ['Rain', '🌧️'],
  65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'],
  67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'],
  73: ['Snow', '🌨️'],
  75: ['Heavy snow', '🌨️'],
  77: ['Snow grains', '🌨️'],
  80: ['Showers', '🌦️'],
  81: ['Showers', '🌦️'],
  82: ['Heavy showers', '⛈️'],
  85: ['Snow showers', '🌨️'],
  86: ['Snow showers', '🌨️'],
  95: ['Thunderstorm', '⛈️'],
  96: ['Thunderstorm', '⛈️'],
  99: ['Thunderstorm', '⛈️'],
};

export function describeWeatherCode(code) {
  const [label, icon] = WMO_CODES[code] || ['—', '·'];
  return { label, icon };
}

export function buildForecastUrl(weather, { start, end } = {}) {
  const params = new URLSearchParams({
    latitude: String(weather.latitude),
    longitude: String(weather.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: weather.timezone || 'auto',
  });
  if (start && end) {
    params.set('start_date', start);
    params.set('end_date', end);
  }
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

/** Open-Meteo's parallel arrays -> { 'YYYY-MM-DD': { icon, label, max, min } }. */
export function parseForecast(json) {
  const daily = json?.daily;
  if (!daily || !Array.isArray(daily.time)) return {};

  const out = {};
  daily.time.forEach((iso, index) => {
    const code = daily.weather_code?.[index];
    const max = daily.temperature_2m_max?.[index];
    const min = daily.temperature_2m_min?.[index];
    const { label, icon } = describeWeatherCode(code);
    out[iso] = {
      label,
      icon,
      max: Number.isFinite(max) ? Math.round(max) : null,
      min: Number.isFinite(min) ? Math.round(min) : null,
    };
  });
  return out;
}

/**
 * Forecast for a date range, or {} if anything at all goes wrong. Open-Meteo
 * only forecasts a couple of weeks ahead, so past and far-future weeks simply
 * come back empty and the strip hides.
 */
export async function fetchForecast(weather, range, { fetchImpl = globalThis.fetch } = {}) {
  if (!weather?.enabled || !Number.isFinite(weather.latitude) || !Number.isFinite(weather.longitude)) return {};
  try {
    const response = await fetchImpl(buildForecastUrl(weather, range), { cache: 'no-store' });
    if (!response.ok) return {};
    return parseForecast(await response.json());
  } catch {
    return {};
  }
}
