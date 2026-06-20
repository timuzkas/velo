import type { Coordinate } from './types';

export type PlaceSuggestion = {
  id: string;
  label: string;
  coordinate: Coordinate;
};

type NominatimPlace = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    addressdetails: '0',
    limit: '5',
    countrycodes: 'lt,lv,ee,pl',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Place search failed with ${response.status}`);
  }

  const places = (await response.json()) as NominatimPlace[];
  return places.map((place) => ({
    id: String(place.place_id),
    label: place.display_name,
    coordinate: {
      lat: Number(place.lat),
      lon: Number(place.lon),
    },
  }));
}
