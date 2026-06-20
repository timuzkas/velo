import { useEffect, useMemo, useRef } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import { appConfig } from '../config';
import { getModePreset } from '../routing';
import type { BikeRoute, Coordinate } from '../types';

type MapViewProps = {
  route: BikeRoute | null;
  userLocation?: Coordinate | null;
  userHeadingDegrees?: number | null;
  followUser?: boolean;
  onUserPan?: () => void;
  onMapClick?: (coordinate: Coordinate) => void;
};

export function MapView({ route, userLocation, userHeadingDegrees, followUser = false, onUserPan, onMapClick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const clickHandlerRef = useRef(onMapClick);
  const userPanHandlerRef = useRef(onUserPan);
  clickHandlerRef.current = onMapClick;
  userPanHandlerRef.current = onUserPan;

  const style = useMemo(
    () => ({
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: [appConfig.tileUrl],
          tileSize: 256,
          attribution: appConfig.tileAttribution,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: style as maplibregl.StyleSpecification,
      center: [appConfig.defaultCenter.lon, appConfig.defaultCenter.lat],
      zoom: appConfig.defaultZoom,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.on('click', (event) => {
      clickHandlerRef.current?.({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });
    map.on('dragstart', () => userPanHandlerRef.current?.());
    map.on('zoomstart', (event) => {
      if (event.originalEvent) userPanHandlerRef.current?.();
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [style]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateRoute = () => {
      if (!map.getSource('route')) {
        map.addSource('route', {
          type: 'geojson',
          data: emptyFeatureCollection(),
        });
        map.addLayer({
          id: 'route-shadow',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#ffffff',
            'line-width': 10,
            'line-opacity': 0.9,
          },
        });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#149e6c',
            'line-width': 6,
            'line-opacity': 0.95,
          },
        });
      }

      const source = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
      source?.setData(route ? routeFeature(route) : emptyFeatureCollection());
      if (route && map.getLayer('route-line')) {
        map.setPaintProperty('route-line', 'line-color', getModePreset(route.mode).color);
      }

      if (route?.geometry.length) {
        const bounds = route.geometry.reduce(
          (box, point) => box.extend([point.lon, point.lat]),
          new LngLatBounds([route.geometry[0].lon, route.geometry[0].lat], [route.geometry[0].lon, route.geometry[0].lat]),
        );
        map.fitBounds(bounds, { padding: 70, duration: 700, maxZoom: 15 });
      }
    };

    if (map.loaded()) updateRoute();
    else map.once('load', updateRoute);
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateLocation = () => {
      if (!map.getSource('location')) {
        map.addSource('location', {
          type: 'geojson',
          data: emptyFeatureCollection(),
        });
        map.addLayer({
          id: 'location-ring',
          type: 'circle',
          source: 'location',
          paint: {
            'circle-color': '#14a05f',
            'circle-radius': 10,
            'circle-opacity': 0.18,
          },
        });
        map.addLayer({
          id: 'location-dot',
          type: 'symbol',
          source: 'location',
          layout: {
            'text-field': '▲',
            'text-size': 24,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-rotate': ['get', 'heading'],
            'text-rotation-alignment': 'map',
          },
          paint: {
            'text-color': '#146c43',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2,
          },
        });
      }

      const source = map.getSource('location') as maplibregl.GeoJSONSource | undefined;
      source?.setData(userLocation ? pointFeature(userLocation, userHeadingDegrees ?? 0) : emptyFeatureCollection());
      if (followUser && userLocation) {
        map.easeTo({
          center: [userLocation.lon, userLocation.lat],
          zoom: Math.max(map.getZoom(), 16),
          bearing: userHeadingDegrees ?? map.getBearing(),
          duration: 500,
        });
      }
    };

    if (map.loaded()) updateLocation();
    else map.once('load', updateLocation);
  }, [followUser, userHeadingDegrees, userLocation]);

  return <div ref={containerRef} className="map-canvas" aria-label="Route map" />;
}

function routeFeature(route: BikeRoute): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: route.geometry.map((point) => [point.lon, point.lat]),
        },
      },
    ],
  };
}

function pointFeature(point: Coordinate, heading: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { heading },
        geometry: {
          type: 'Point',
          coordinates: [point.lon, point.lat],
        },
      },
    ],
  };
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
