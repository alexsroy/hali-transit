const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const StreamZip = require('node-stream-zip');
const { parse } = require('csv-parse/sync');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const STATIC_ZIP_PATH = path.join(__dirname, '..', 'google_transit.zip');
const VEHICLE_POSITIONS_PATH = path.join(__dirname, '..', 'VehiclePositions.pb');

const PORT = Number(process.env.PORT) || 4000;

async function bootstrap() {
  const app = express();
  app.use(cors());

  const staticDataPromise = loadStaticData();

  app.get('/api/static/summary', async (req, res, next) => {
    try {
      const data = await staticDataPromise;
      res.json({
        routes: data.routes,
        stops: data.stops,
        trips: data.trips
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
      const data = await staticDataPromise;
      const points = data.shapesById.get(String(shapeId)) ?? [];
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

    const [routesRaw, stopsRaw, tripsRaw, shapesRaw] = await Promise.all([
      readCsv('routes.txt'),
      readCsv('stops.txt'),
      readCsv('trips.txt'),
      readCsv('shapes.txt')
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

    console.log('Loaded GTFS static data.');
    return { routes, stops, trips, shapesById };
  } finally {
    await zip.close();
  }
}

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

function parseCsv(contents) {
  return parse(contents, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

async function loadVehiclePositions() {
  const buffer = await fs.promises.readFile(VEHICLE_POSITIONS_PATH);
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

function parseFloatSafe(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function parseIntSafe(value) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}
