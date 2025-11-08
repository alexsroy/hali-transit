const fs = require('fs');
const path = require('path');

loadEnvFromFile();

const baseConfig = require('./app.json');
const expoConfig = baseConfig.expo ?? {};

const mapsKey =
  process.env.GOOGLE_MAPS_API_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
  expoConfig.ios?.config?.googleMapsApiKey ??
  expoConfig.android?.config?.googleMaps?.apiKey ??
  '';

const resolvedBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

module.exports = () => ({
  ...baseConfig,
  expo: {
    ...expoConfig,
    ios: {
      ...expoConfig.ios,
      config: {
        ...expoConfig.ios?.config,
        googleMapsApiKey: mapsKey
      }
    },
    android: {
      ...expoConfig.android,
      config: {
        ...expoConfig.android?.config,
        googleMaps: {
          ...expoConfig.android?.config?.googleMaps,
          apiKey: mapsKey
        }
      }
    },
    extra: {
      ...expoConfig.extra,
      apiBaseUrl: resolvedBaseUrl
    }
  }
});

function loadEnvFromFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, 'utf8');
  contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith('#')) {
        return;
      }
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    });
}
