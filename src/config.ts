import type { Coordinate } from './types';

export const appConfig = {
  appName: 'Velo',
  defaultCenter: { lat: 54.6872, lon: 25.2797 } satisfies Coordinate,
  defaultZoom: 12,
  orsApiKey: import.meta.env.VITE_ORS_API_KEY as string | undefined,
  orsBaseUrl: import.meta.env.VITE_ORS_BASE_URL || 'https://api.openrouteservice.org',
  tileUrl:
    import.meta.env.VITE_TILE_URL ||
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution:
    import.meta.env.VITE_TILE_ATTRIBUTION ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
