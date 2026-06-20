import type { BikeRoute, RideState } from './types';

const routeKey = 'velo:last-route';
const rideKey = 'velo:last-ride';
const orsApiKey = 'velo:ors-api-key';

export function loadRoute(): BikeRoute | null {
  const route = loadJson<BikeRoute>(routeKey);
  if (!route) return null;
  return {
    ...route,
    waypoints: Array.isArray(route.waypoints) ? route.waypoints : [],
    maneuvers: Array.isArray(route.maneuvers) ? route.maneuvers : [],
    geometry: Array.isArray(route.geometry) ? route.geometry : [],
  };
}

export function saveRoute(route: BikeRoute): void {
  localStorage.setItem(routeKey, JSON.stringify(route));
}

export function loadRide(): RideState | null {
  return loadJson<RideState>(rideKey);
}

export function saveRide(ride: RideState): void {
  localStorage.setItem(rideKey, JSON.stringify(ride));
}

export function loadOrsApiKey(): string {
  return localStorage.getItem(orsApiKey) ?? '';
}

export function saveOrsApiKey(value: string): void {
  const trimmed = value.trim();
  if (trimmed) localStorage.setItem(orsApiKey, trimmed);
  else localStorage.removeItem(orsApiKey);
}

function loadJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
