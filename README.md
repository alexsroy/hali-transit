# Transit

This repository contains an Expo/React Native client and a lightweight Node/Express backend that visualise Halifax Transit service using GTFS static data and realtime feeds.

## Features
- Dark-themed Google Maps powered UI with vehicles, shapes, and stops.
- Drawer-style trip planner that surfaces nearby routes and stop ETAs.
- Realtime polling of vehicle positions with stale-data detection.
- GTFS static summary ingested on startup plus shape fetching on demand.

## Getting Started

### Prerequisites
- Node.js 18+ (ships with npm)
- Expo CLI (`npm install -g expo-cli`) if you want to run on device/emulator

### Install dependencies
```bash
npm install
```

### Run the mobile app
```bash
npm run start   # Expo Dev Tools
```
Then pick `i`/`a`/`w` inside the Metro console for iOS/Android/Web respectively.

### Run the backend locally
```bash
npm run backend
```
The backend lives under `backend/server.js` and exposes endpoints the app queries at `resolveApiBaseUrl()`.

## Project Structure
- `App.js` – Entry point that renders the `TransitScreen`.
- `src/screens/TransitScreen.js` – Orchestrates hooks, map, and sheet UI.
- `src/components` – Map markers, bottom sheet, and shared UI elements.
- `src/hooks` – Data fetching and visibility logic.
- `src/utils` – Helper math/formatting functions.
- `backend/` – Express server wrapping GTFS static + realtime feeds.

## Scripts
| Command            | Description                       |
|--------------------|-----------------------------------|
| `npm run start`    | Launch Expo dev server            |
| `npm run android`  | Build & run on Android            |
| `npm run ios`      | Build & run on iOS                |
| `npm run web`      | Run Expo web target               |
| `npm run lint`     | Lint the project (ESLint)         |
| `npm run backend`  | Start local backend API server    |

## Environment
The client determines the backend host via `resolveApiBaseUrl()`, which reads from `EXPO_PUBLIC_API_BASE_URL` when available. Configure this to point at your backend instance when deploying.



## License
MIT (see `LICENSE` if present).
