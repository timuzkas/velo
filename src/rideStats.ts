import { distanceMeters } from './geo';
import type { RideSample, RideState } from './types';

export type ComputedRideStats = {
  elapsedSeconds: number;
  distanceMeters: number;
  currentSpeedMps: number;
  averageSpeedMps: number;
  maxSpeedMps: number;
};

export function computeRideStats(ride: RideState, now = Date.now()): ComputedRideStats {
  const samples = ride.samples;
  const startedAt = ride.startedAt ?? now;
  const endedAt = ride.endedAt ?? now;
  const elapsedSeconds = ride.active ? (now - startedAt) / 1000 : Math.max(0, (endedAt - startedAt) / 1000);
  const distance = samples.slice(1).reduce((sum, sample, index) => {
    const previous = samples[index];
    return sum + distanceMeters(previous, sample);
  }, 0);
  const speedSamples = samples
    .map((sample) => sample.speedMps)
    .filter((speed): speed is number => typeof speed === 'number' && Number.isFinite(speed) && speed >= 0);
  const currentSpeedMps = speedSamples.at(-1) ?? 0;
  const averageSpeedMps = elapsedSeconds > 0 ? distance / elapsedSeconds : 0;
  const maxSpeedMps = speedSamples.length > 0 ? Math.max(...speedSamples) : 0;

  return {
    elapsedSeconds,
    distanceMeters: distance,
    currentSpeedMps,
    averageSpeedMps,
    maxSpeedMps,
  };
}

export function sampleFromPosition(position: GeolocationPosition): RideSample {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    timestamp: position.timestamp,
    speedMps: position.coords.speed,
    headingDegrees: position.coords.heading,
    accuracyMeters: position.coords.accuracy,
  };
}
