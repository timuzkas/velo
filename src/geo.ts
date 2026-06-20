import type { Coordinate } from './types';

const earthRadiusMeters = 6_371_000;

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function routeDistanceMeters(points: Coordinate[]): number {
  return points.slice(1).reduce((sum, point, index) => sum + distanceMeters(points[index], point), 0);
}

export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function deriveHeadingDegrees(points: Coordinate[]): number | null {
  if (points.length < 2) return null;
  const latest = points.at(-1)!;
  const previous = [...points].reverse().find((point) => distanceMeters(point, latest) > 2);
  return previous ? bearingDegrees(previous, latest) : null;
}

export function nearestRouteProgressMeters(route: Coordinate[], location: Coordinate | null): number {
  if (!location || route.length < 2) return 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let cumulative = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const segmentMeters = distanceMeters(start, end);
    const projected = projectPointOnSegment(location, start, end);
    const projectedPoint = interpolateCoordinate(start, end, projected);
    const candidateDistance = distanceMeters(location, projectedPoint);

    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestProgress = cumulative + segmentMeters * projected;
    }

    cumulative += segmentMeters;
  }

  return Math.min(cumulative, Math.max(0, bestProgress));
}

export function cumulativeManeuverProgressMeters(distances: number[]): number[] {
  let total = 0;
  return distances.map((distance) => {
    total += Math.max(0, distance);
    return total;
  });
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.round((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes.toString().padStart(2, '0')} min`;
}

export function formatSpeed(mps: number): string {
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function interpolateCoordinate(start: Coordinate, end: Coordinate, progress: number): Coordinate {
  return {
    lat: start.lat + (end.lat - start.lat) * progress,
    lon: start.lon + (end.lon - start.lon) * progress,
  };
}

function projectPointOnSegment(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const centerLat = toRadians((start.lat + end.lat + point.lat) / 3);
  const pointX = point.lon * Math.cos(centerLat);
  const pointY = point.lat;
  const startX = start.lon * Math.cos(centerLat);
  const startY = start.lat;
  const endX = end.lon * Math.cos(centerLat);
  const endY = end.lat;
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  const progress = ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared;
  return Math.min(1, Math.max(0, progress));
}
