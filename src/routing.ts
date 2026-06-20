import { appConfig } from './config';
import { routeDistanceMeters } from './geo';
import type { BikeRoute, Coordinate, RouteMode } from './types';

type RouteRequest = {
  start: Coordinate;
  end: Coordinate;
  waypoints?: Coordinate[];
  mode: RouteMode;
  apiKey?: string;
};

type OrsFeature = {
  geometry: { coordinates: [number, number][] };
  properties: {
    summary?: { distance?: number; duration?: number };
    segments?: Array<{
      distance?: number;
      duration?: number;
      steps?: Array<{ instruction?: string; distance?: number; name?: string }>;
    }>;
    ascent?: number;
  };
};

const modePresets: Record<RouteMode, { label: string; color: string; orsProfile: string; speedKph: number }> = {
  fastest: {
    label: 'Fastest',
    color: '#0b7f54',
    orsProfile: 'cycling-road',
    speedKph: 24,
  },
  flexible: {
    label: 'Flexible',
    color: '#149e6c',
    orsProfile: 'cycling-regular',
    speedKph: 19,
  },
  safest: {
    label: 'Safest',
    color: '#5aa85a',
    orsProfile: 'cycling-regular',
    speedKph: 16,
  },
};

export function getModePreset(mode: RouteMode) {
  return modePresets[mode];
}

export async function calculateRoute(request: RouteRequest): Promise<BikeRoute> {
  const apiKey = request.apiKey || appConfig.orsApiKey;
  if (apiKey) {
    try {
      return await calculateOpenRouteServiceRoute(request, apiKey);
    } catch (error) {
      console.warn('OpenRouteService failed, falling back to local demo route.', error);
    }
  }

  return createLocalRoute(request);
}

async function calculateOpenRouteServiceRoute(
  { start, end, waypoints = [], mode }: RouteRequest,
  apiKey: string,
): Promise<BikeRoute> {
  const preset = modePresets[mode];
  const routePoints = [start, ...waypoints, end];
  const response = await fetch(`${appConfig.orsBaseUrl}/v2/directions/${preset.orsProfile}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      coordinates: [
        ...routePoints.map((point) => [point.lon, point.lat]),
      ],
      elevation: true,
      instructions: true,
      preference: mode === 'fastest' ? 'fastest' : 'recommended',
      options:
        mode === 'safest'
          ? {
              avoid_features: ['ferries'],
              profile_params: {
                weightings: {
                  green: 0.8,
                  quiet: 0.9,
                },
              },
            }
          : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Routing failed with ${response.status}`);
  }

  const data = (await response.json()) as { features: OrsFeature[] };
  const feature = data.features[0];
  if (!feature) throw new Error('Routing response did not include a route');

  const geometry = feature.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const distanceMeters = feature.properties.summary?.distance ?? routeDistanceMeters(geometry);
  const durationSeconds =
    feature.properties.summary?.duration ?? (distanceMeters / (preset.speedKph * 1000)) * 3600;

  return {
    id: crypto.randomUUID(),
    mode,
    geometry,
    waypoints,
    distanceMeters,
    durationSeconds,
    elevationGainMeters: feature.properties.ascent,
    maneuvers:
      feature.properties.segments?.flatMap((segment) =>
        segment.steps?.map((step) => ({
          instruction: step.instruction || 'Continue',
          distanceMeters: step.distance || 0,
          streetName: step.name,
        })) ?? [],
      ) ?? [],
    provider: 'OpenRouteService',
  };
}

function createLocalRoute({ start, end, waypoints = [], mode }: RouteRequest): BikeRoute {
  const preset = modePresets[mode];
  const bend = mode === 'fastest' ? 0.012 : mode === 'flexible' ? 0.02 : 0.032;
  const routePoints = [start, ...waypoints, end];
  const geometry = routePoints.flatMap((point, index) => {
    const next = routePoints[index + 1];
    if (!next) return [point];
    return [
      point,
      {
        lat: point.lat + (next.lat - point.lat) * 0.45 + bend / (index + 1),
        lon: point.lon + (next.lon - point.lon) * 0.45 - bend / (index + 2),
      },
      {
        lat: point.lat + (next.lat - point.lat) * 0.72 - bend / (index + 2),
        lon: point.lon + (next.lon - point.lon) * 0.72 + bend / (index + 1),
      },
    ];
  });
  const rawDistance = routeDistanceMeters(geometry);
  const distanceMultiplier = mode === 'fastest' ? 1 : mode === 'flexible' ? 1.08 : 1.18;
  const distanceMeters = rawDistance * distanceMultiplier;

  return {
    id: crypto.randomUUID(),
    mode,
    geometry,
    waypoints,
    distanceMeters,
    durationSeconds: (distanceMeters / (preset.speedKph * 1000)) * 3600,
    elevationGainMeters: mode === 'safest' ? 38 : mode === 'flexible' ? 52 : 68,
    maneuvers: [
      { instruction: 'Start riding toward the route', distanceMeters: 240 },
      { instruction: mode === 'safest' ? 'Join the quieter cycling corridor' : 'Continue on the main cycling line', distanceMeters: distanceMeters * 0.45 },
      { instruction: 'Keep following the highlighted route', distanceMeters: distanceMeters * 0.35 },
      { instruction: 'Arrive at destination', distanceMeters: 0 },
    ],
    provider: 'Local demo route',
  };
}
