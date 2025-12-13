// Fetches scheduled arrivals for a stop from the backend.

import { useEffect, useState } from 'react';

/** Returns the scheduled arrivals for a stop from GTFS static data. */
export default function useUpcommingArrivals(stopId, apiBaseUrl) {
  const [arrivals, setArrivals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!stopId) {
      setArrivals([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/static/stop-arrivals?stopId=${encodeURIComponent(stopId)}`, //removed the realtime request temporarily: /api/realtime/stop-arrivals
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`Upcomming arrivals request failed (${response.status})`);
        }
        const payload = await response.json();
        if (!cancelled) {
          setArrivals(payload.arrivals ?? []);
        }
      } catch (fetchError) {
        if (cancelled || fetchError.name === 'AbortError') {
          return;
        }
        console.error('Failed to load upcomming arrivals', fetchError);
        setError(fetchError.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBaseUrl, stopId]);

  return { realTimeArrivals: arrivals, scheduleLoading: loading, scheduleError: error };
}
