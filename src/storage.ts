import type { BikeRoute, RideState, SavedPlace } from './types';

const routeKey = 'velo:last-route';
const rideKey = 'velo:last-ride';
const orsApiKey = 'velo:ors-api-key';
const savedRoutesKey = 'velo:saved-routes';
const savedPlacesKey = 'velo:saved-places';

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
  const normalized = normalizeRoute(route);
  localStorage.setItem(routeKey, JSON.stringify(normalized));
  saveRouteToHistory(normalized);
}

export function clearRoute(): void {
  localStorage.removeItem(routeKey);
}

export function loadSavedRoutes(): BikeRoute[] {
  return (loadJson<BikeRoute[]>(savedRoutesKey) ?? []).map(normalizeRoute);
}

export function saveRouteToHistory(route: BikeRoute): void {
  const normalized = normalizeRoute(route);
  const routes = loadSavedRoutes().filter((savedRoute) => savedRoute.id !== normalized.id);
  localStorage.setItem(savedRoutesKey, JSON.stringify([normalized, ...routes].slice(0, 12)));
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

export function loadSavedPlaces(): Partial<Record<'home' | 'work', SavedPlace>> {
  return loadJson<Partial<Record<'home' | 'work', SavedPlace>>>(savedPlacesKey) ?? {};
}

export function saveSavedPlace(kind: 'home' | 'work', place: SavedPlace): Partial<Record<'home' | 'work', SavedPlace>> {
  const places = loadSavedPlaces();
  const next = { ...places, [kind]: place };
  localStorage.setItem(savedPlacesKey, JSON.stringify(next));
  return next;
}

function normalizeRoute(route: BikeRoute): BikeRoute {
  return {
    ...route,
    waypoints: Array.isArray(route.waypoints) ? route.waypoints : [],
    maneuvers: Array.isArray(route.maneuvers) ? route.maneuvers : [],
    geometry: Array.isArray(route.geometry) ? route.geometry : [],
    createdAt: route.createdAt ?? Date.now(),
  };
}

function loadJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
