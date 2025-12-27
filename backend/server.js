// Simple Express server that serves GTFS static and realtime proxy endpoints.

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const StreamZip = require('node-stream-zip');
const { parse } = require('csv-parse/sync');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const loadEnvFromFile = require('../loadEnv');

loadEnvFromFile(path.join(__dirname, '..', '.env'));

const STATIC_ZIP_PATH = path.join(__dirname, '..', 'google_transit.zip');
const VEHICLE_POSITIONS_URL = 'https://gtfs.halifax.ca/realtime/Vehicle/VehiclePositions.pb';
const TRIP_UPDATES_URL = 'https://gtfs.halifax.ca/realtime/TripUpdate/TripUpdates.pb';


const PORT = Number(process.env.PORT) || 4000;
const weekdayKeys = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday'
];

//All static data (so it doesn't get called every time)
let routes;
let stops;
let staticTrips;
let shapesById;
let stopSchedulesByStopId;
let routesById;
let staticTripsById;
let calendarByServiceId;
/** Spins up the Express server and wires API routes. */
async function bootstrap() {
  const app = express();
  app.use(cors());

  ({
    routes,
    stops,
    trips: staticTrips,
    shapesById,
    stopSchedulesByStopId,
    routesById,
    staticTripsById,
    calendarByServiceId
  } = await loadStaticData());

  if (!staticTripsById || !routesById) {
    throw new Error('GTFS static data failed to initialize');
  }

  app.get('/api/static/summary', async (req, res, next) => {
    try {
      res.json({
        routes,
        stops,
        staticTrips
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/static/shape', async (req, res, next) => {
    const shapeId = req.query.shapeId;
    if (!shapeId) {
      res.status(400).json({ error: 'shapeId query parameter is required.' });
      return;
    }

    try {
      const points = shapesById.get(String(shapeId)) ?? [];
      res.json({ points });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/realtime/vehicles', async (req, res, next) => {
    try {
      const vehicles = await loadVehiclePositions();
      res.json({ vehicles });
    } catch (error) {
      next(error);
    }
  });


  app.get('/api/realtime/stop-arrivals', async (req, res, next) => {
    const stopId = req.query.stopId;
    if (!stopId) {
      res.status(400).json({ error: 'stopId query parameter is required.' });
      return;
    }

    try {

      if (!staticTripsById || !routesById) {
        throw new Error('Static GTFS data not loaded correctly');
      }

      const arrivals = await getBusesArrivingAtStop(stopId);
      res.json({ arrivals });
    } catch (error) {
      next(error);
    }
  });


  app.get('/api/static/stop-arrivals', async (req, res, next) => {
    const stopId = req.query.stopId;
    if (!stopId) {
      res.status(400).json({ error: 'stopId query parameter is required.' });
      return;
    }

    try {

      const schedule = stopSchedulesByStopId.get(String(stopId)) ?? [];

      // ---- Convert "HH:MM:SS" -> seconds since midnight ----
      function timeToSeconds(t) {
        const [h, m, s] = t.split(':').map(Number);
        return h * 3600 + m * 60 + s;
      }

      // ---- Current time in seconds since midnight ----
      const now = new Date();
      const secondsSinceMidnight =
        now.getHours() * 3600 +
        now.getMinutes() * 60 +
        now.getSeconds();

      // ---- Filter + sort upcoming arrivals ----
      const filtered = schedule
        .filter(entry => timeToSeconds(entry.arrivalTime) >= secondsSinceMidnight)
        .sort((a, b) => timeToSeconds(a.arrivalTime) - timeToSeconds(b.arrivalTime))
        .slice(0, 20);

      const arrivals = filtered
        .filter(entry => {
          const trip = staticTripsById.get(entry.tripId);
          if (!trip) return false;
          return isServiceRunningToday(trip.service_id);
        })
        .map(entry => {
          const trip = staticTripsById.get(entry.tripId);
          const route = trip?.route_id
            ? routesById.get(trip.route_id) ?? null
            : null;

          return {
            tripId: entry.tripId,
            arrivalTime: entry.arrivalTime,
            arrivalLabel: entry.arrivalLabel,
            stopSequence: entry.stopSequence,
            routeId: trip?.route_id ?? null,
            routeShortName: route?.route_short_name ?? null,
            routeLongName: route?.route_long_name ?? null,
            headsign: trip?.trip_headsign ?? null,
            dataSource: "Scheduled"
          };
        });

      res.json({ arrivals });
    } catch (error) {
      next(error);
    }
  });


  app.get('/api/stop-arrivals', async (req, res, next) => {
    const stopId = req.query.stopId;
    if (!stopId) {
      return res.status(400).json({ error: 'stopId query parameter is required.' });
    }

    try {
      const requestTime = parseRequestTime(req);
      const now = new Date();

      const USE_REALTIME_WINDOW_MS = 2 * 60 * 60 * 1000;
      const canUseRealtime =
        Math.abs(requestTime - now) <= USE_REALTIME_WINDOW_MS;

      let realtimeArrivals = [];
      let scheduledArrivals = [];

      if (canUseRealtime) {
        realtimeArrivals = await getBusesArrivingAtStop(stopId);
      }

      scheduledArrivals = getScheduledArrivalsAtStop(stopId, requestTime);

      const arrivals = mergeArrivals(realtimeArrivals, scheduledArrivals);

      res.json({ arrivals });
    } catch (err) {
      next(err);
    }
  });




  app.use((error, req, res, _next) => {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`Halifax Transit backend running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exitCode = 1;
});

/** Reads the GTFS zip and returns structured routes/stops/trips/shapes. */
async function loadStaticData() {
  console.log('Loading GTFS static data…');
  const zip = new StreamZip.async({ file: STATIC_ZIP_PATH });

  try {
    const entries = await zip.entries();
    const readCsv = async (target) => {
      const entryName = findEntry(entries, target);
      const buffer = await zip.entryData(entryName);
      return parseCsv(buffer.toString('utf8'));
    };

    const [routesRaw, stopsRaw, tripsRaw, shapesRaw, stopTimesRaw, calendarRaw] = await Promise.all([
      readCsv('routes.txt'),
      readCsv('stops.txt'),
      readCsv('trips.txt'),
      readCsv('shapes.txt'),
      readCsv('stop_times.txt'),
      readCsv('calendar.txt')
    ]);

    const routes = routesRaw.map((route) => ({
      route_id: route.route_id,
      route_short_name: route.route_short_name,
      route_long_name: route.route_long_name,
      route_desc: route.route_desc,
      route_type: parseIntSafe(route.route_type),
      route_color: route.route_color
    }));

    const stops = stopsRaw.map((stop) => ({
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      stop_lat: parseFloatSafe(stop.stop_lat),
      stop_lon: parseFloatSafe(stop.stop_lon)
    }));

    const trips = tripsRaw.map((trip) => ({
      route_id: trip.route_id,
      service_id: trip.service_id,
      trip_id: trip.trip_id,
      trip_headsign: trip.trip_headsign,
      direction_id: parseIntSafe(trip.direction_id),
      shape_id: trip.shape_id
    }));

    const routesById = new Map(routes.map((route) => [route.route_id, route]));
    const staticTripsById = new Map(trips.map((trip) => [trip.trip_id, trip]));

    const shapesById = new Map();
    shapesRaw.forEach((shape) => {
      if (!shape.shape_id) {
        return;
      }
      const latitude = parseFloatSafe(shape.shape_pt_lat);
      const longitude = parseFloatSafe(shape.shape_pt_lon);
      if (latitude == null || longitude == null) {
        return;
      }
      const sequence = parseIntSafe(shape.shape_pt_sequence) ?? 0;
      const points = shapesById.get(shape.shape_id) ?? [];
      points.push({
        shape_pt_lat: latitude,
        shape_pt_lon: longitude,
        shape_pt_sequence: sequence
      });
      shapesById.set(shape.shape_id, points);
    });

    for (const pointList of shapesById.values()) {
      pointList.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
    }

    const stopSchedulesByStopId = new Map();
    stopTimesRaw.forEach((stopTime) => {
      const stopId = stopTime.stop_id;
      const tripId = stopTime.trip_id;
      if (!stopId || !tripId) {
        return;
      }
      const arrivalTime = stopTime.arrival_time || stopTime.departure_time;
      if (!arrivalTime) {
        return;
      }
      const arrivalSeconds = timeToSeconds(arrivalTime);
      if (arrivalSeconds == null) {
        return;
      }
      const stopSequence = parseIntSafe(stopTime.stop_sequence) ?? 0;
      const entry = {
        tripId,
        arrivalTime,
        arrivalLabel: formatScheduleLabel(arrivalTime),
        arrivalSeconds,
        stopSequence
      };
      const list = stopSchedulesByStopId.get(stopId) ?? [];
      list.push(entry);
      stopSchedulesByStopId.set(stopId, list);
    });

    for (const list of stopSchedulesByStopId.values()) {
      list.sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);
    }

    const calendarByServiceId = new Map();

    calendarRaw.forEach(row => {
      if (!row.service_id) return;

      calendarByServiceId.set(row.service_id, {
        monday: row.monday === '1',
        tuesday: row.tuesday === '1',
        wednesday: row.wednesday === '1',
        thursday: row.thursday === '1',
        friday: row.friday === '1',
        saturday: row.saturday === '1',
        sunday: row.sunday === '1',
        startDate: parseYyyyMmDd(row.start_date),
        endDate: parseYyyyMmDd(row.end_date)
      });
    });

    console.log('Loaded GTFS static data.');
    return { routes, stops, trips, shapesById, stopSchedulesByStopId, routesById, staticTripsById, calendarByServiceId };
  } finally {
    await zip.close();
  }
}

function parseRequestTime(req) {
  if (!req.query.time) return new Date();
  const t = new Date(req.query.time);
  return isNaN(t.getTime()) ? new Date() : t;
}


function getScheduledArrivalsAtStop(stopId, time) {
  const schedule = stopSchedulesByStopId.get(String(stopId)) ?? [];

  const secondsSinceMidnight =
    time.getHours() * 3600 +
    time.getMinutes() * 60 +
    time.getSeconds();

  function timeToSeconds(t) {
    const [h, m, s] = t.split(':').map(Number);
    return h * 3600 + m * 60 + s;
  }

  return schedule
    .filter(entry => timeToSeconds(entry.arrivalTime) >= secondsSinceMidnight)
    .filter(entry => {
      const trip = staticTripsById.get(entry.tripId);
      return trip && isServiceRunningToday(trip.service_id);
    })
    .map(entry => {
      const trip = staticTripsById.get(entry.tripId);
      const route = trip?.route_id
        ? routesById.get(trip.route_id)
        : null;

      return {
        tripId: entry.tripId,
        arrivalTime: entry.arrivalTime,
        arrivalLabel: entry.arrivalLabel,
        stopSequence: entry.stopSequence,
        routeId: trip?.route_id ?? null,
        routeShortName: route?.route_short_name ?? null,
        routeLongName: route?.route_long_name ?? null,
        headsign: trip?.trip_headsign ?? null,
        dataSource: "Scheduled"
      };
    });
}

function mergeArrivals(realtime, scheduled) {
  const byTripId = new Map();

  for (const r of realtime) {
    byTripId.set(r.tripId, { ...r});
  }

  for (const s of scheduled) {
    if (!byTripId.has(s.tripId)) {
      byTripId.set(s.tripId, s);
    }
  }

  const arrivals = Array.from(byTripId.values());

  arrivals.sort((a, b) =>
    a.arrivalTime.localeCompare(b.arrivalTime)
  );

  return arrivals.slice(0, 20);
}




/** Locates a file inside the GTFS zip regardless of directory casing. */
function findEntry(entries, targetName) {
  const lower = targetName.toLowerCase();
  for (const [entryName, entry] of Object.entries(entries)) {
    if (entry.isDirectory) {
      continue;
    }
    if (entryName.toLowerCase().endsWith(lower)) {
      return entryName;
    }
  }
  throw new Error(`Unable to locate ${targetName} inside GTFS zip.`);
}

/** Parses a GTFS CSV file into an array of objects. */
function parseCsv(contents) {
  return parse(contents, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function timeToSeconds(value) {
  if (!value) {
    return null;
  }
  const parts = value.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  const [hours, minutes, seconds = 0] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatScheduleLabel(timeString) {
  if (!timeString) {
    return '';
  }
  const [hours, minutes] = timeString.split(':');
  const hourNumber = Number.parseInt(hours, 10) % 24;
  return `${String(hourNumber).padStart(2, '0')}:${minutes ?? '00'}`;
}

function isServiceRunningToday(serviceId, today = new Date()) {
  const service = calendarByServiceId.get(serviceId);
  if (!service) return false;

  const dayKey = weekdayKeys[today.getDay()];

  if (!service[dayKey]) return false;
  if (today < service.startDate) return false;
  if (today > service.endDate) return false;

  return true;
}

function formatHHMM(date) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  return date.toLocaleTimeString('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function parseYyyyMmDd(str) {
  const y = Number(str.slice(0, 4));
  const m = Number(str.slice(4, 6)) - 1;
  const d = Number(str.slice(6, 8));
  return new Date(y, m, d);
}


async function getBusesArrivingAtStop(stopId) {
  const buffer = await readTripUpdatesBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

  const now = new Date();
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // tripId -> arrival object
  const arrivalsByTripId = new Map();

  feed.entity.forEach(entity => {
    if (!entity.tripUpdate) return;

    const tripUpdate = entity.tripUpdate;
    const tripId = tripUpdate.trip?.tripId;
    if (!tripId) return;

    const tripInfo = staticTripsById.get(tripId) ?? {};
    const routeInfo = tripInfo.route_id
      ? routesById.get(tripInfo.route_id) ?? {}
      : {};

    tripUpdate.stopTimeUpdate?.forEach(stopTime => {
      if (stopTime.stopId !== stopId) return;

      const arrivalTimestamp =
        stopTime.arrival?.time ?? stopTime.departure?.time;
      if (!arrivalTimestamp) return;

      const arrivalDate = new Date(arrivalTimestamp * 1000);
      if (arrivalDate < now || arrivalDate > twoHoursLater) return;

      const arrival = {
        tripId,
        arrivalTime: formatHHMM(arrivalDate),
        arrivalLabel: tripUpdate.vehicle?.label ?? null,
        stopSequence: stopTime.stopSequence ?? null,
        routeId: tripInfo.route_id ?? null,
        routeShortName: routeInfo.route_short_name ?? null,
        routeLongName: routeInfo.route_long_name ?? null,
        headsign: tripInfo.trip_headsign ?? null,
        dataSource: "Realtime"
      };

      const existing = arrivalsByTripId.get(tripId);

      // Keep the earliest arrival per trip
      if (
        !existing ||
        arrival.arrivalTime.localeCompare(existing.arrivalTime) < 0
      ) {
        arrivalsByTripId.set(tripId, arrival);
      }
    });
  });

  const arrivals = Array.from(arrivalsByTripId.values());

  arrivals.sort((a, b) =>
    a.arrivalTime.localeCompare(b.arrivalTime)
  );

  return arrivals.slice(0, 20);
}


/** Downloads the realtime vehicle feed and normalizes each entity. */
async function loadVehiclePositions() {
  const buffer = await readVehicleFeedBuffer();
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

  return feed.entity
    .filter((entity) => entity.vehicle)
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle.position ?? {};
      const trip = vehicle.trip ?? {};
      const descriptor = vehicle.vehicle ?? {};
      return {
        entityId: entity.id,
        vehicleId: descriptor.id ?? descriptor.label ?? entity.id,
        tripId: trip.tripId ?? null,
        routeId: trip.routeId ?? null,
        directionId: trip.directionId ?? null,
        position: {
          latitude: position.latitude,
          longitude: position.longitude,
          bearing: position.bearing,
          speed: position.speed
        },
        timestamp: vehicle.timestamp ? new Date(vehicle.timestamp * 1000).toISOString() : null,
        currentStopSequence: vehicle.currentStopSequence ?? null,
        stopId: vehicle.stopId ?? null,
        congestionLevel: vehicle.congestionLevel ?? null,
        scheduleRelationship: trip.scheduleRelationship ?? null,
        label: descriptor.label ?? null,
        licensePlate: descriptor.licensePlate ?? null
      };
    });
}

/** Fetches the raw protobuf feed either from remote URL or disk. */
async function readVehicleFeedBuffer() {
  const response = await fetch(VEHICLE_POSITIONS_URL);
  if (!response.ok) {
    throw new Error(`Failed to download vehicle positions (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function readTripUpdatesBuffer() {
  const response = await fetch(TRIP_UPDATES_URL);
  if (!response.ok) {
    throw new Error(`Failed to download trip updates (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Parses floats but returns null when the input is invalid. */
function parseFloatSafe(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

/** Parses integers but returns null for blank or invalid strings. */
function parseIntSafe(value) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

/** Loads .env key/value pairs when running the backend locally. */
