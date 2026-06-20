export type Screen = 'planner' | 'ride' | 'stats';

export type RouteMode = 'fastest' | 'flexible' | 'safest';

export type Coordinate = {
  lat: number;
  lon: number;
};

export type Maneuver = {
  instruction: string;
  distanceMeters: number;
  streetName?: string;
};

export type BikeRoute = {
  id: string;
  mode: RouteMode;
  geometry: Coordinate[];
  waypoints: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  elevationGainMeters?: number;
  maneuvers: Maneuver[];
  provider: string;
};

export type RideSample = Coordinate & {
  timestamp: number;
  speedMps: number | null;
  headingDegrees?: number | null;
  accuracyMeters?: number;
};

export type RideState = {
  active: boolean;
  startedAt?: number;
  endedAt?: number;
  samples: RideSample[];
};
