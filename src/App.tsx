import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bike,
  Clock3,
  Compass,
  Flag,
  Gauge,
  KeyRound,
  LocateFixed,
  MapPinned,
  Navigation,
  Plus,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  X,
  Zap,
} from "lucide-react";
import { MapView } from "./components/MapView";
import { appConfig } from "./config";
import { searchPlaces, type PlaceSuggestion } from "./geocoding";
import {
  cumulativeManeuverProgressMeters,
  deriveHeadingDegrees,
  formatDistance,
  formatDuration,
  formatSpeed,
  nearestRouteProgressMeters,
} from "./geo";
import { calculateRoute, getModePreset } from "./routing";
import { computeRideStats, sampleFromPosition } from "./rideStats";
import {
  loadOrsApiKey,
  loadRide,
  loadRoute,
  saveOrsApiKey,
  saveRide,
  saveRoute,
} from "./storage";
import type {
  BikeRoute,
  Coordinate,
  RideState,
  RouteMode,
  Screen,
} from "./types";

type StopPoint = {
  id: string;
  query: string;
  coordinate: Coordinate;
};

type SearchTarget = "start" | "end" | `stop:${string}`;

const demoStart = appConfig.defaultCenter;
const demoEnd = { lat: 54.7201, lon: 25.2962 };

const modeIcons = {
  fastest: Zap,
  flexible: Sparkles,
  safest: ShieldCheck,
};

export function App() {
  const [screen, setScreen] = useState<Screen>("planner");
  const [mode, setMode] = useState<RouteMode>("flexible");
  const [start, setStart] = useState<Coordinate>(demoStart);
  const [end, setEnd] = useState<Coordinate>(demoEnd);
  const [stops, setStops] = useState<StopPoint[]>([]);
  const [startQuery, setStartQuery] = useState("Vilnius center");
  const [endQuery, setEndQuery] = useState("Verkiai direction");
  const [suggestions, setSuggestions] = useState<
    Record<string, PlaceSuggestion[]>
  >({});
  const [activeTarget, setActiveTarget] = useState<SearchTarget | null>(null);
  const [searchingTarget, setSearchingTarget] = useState<SearchTarget | null>(
    null,
  );
  const savedInitialKey = useMemo(() => loadOrsApiKey(), []);
  const [apiKey, setApiKey] = useState(savedInitialKey);
  const [apiKeyDraft, setApiKeyDraft] = useState(savedInitialKey);
  const [keyDialogOpen, setKeyDialogOpen] = useState(!savedInitialKey);
  const [route, setRoute] = useState<BikeRoute | null>(() => loadRoute());
  const [ride, setRide] = useState<RideState>(
    () => loadRide() ?? { active: false, samples: [] },
  );
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const watchIdRef = useRef<number | null>(null);
  const hasRoute = Boolean(route);
  const hasApiKey = Boolean(apiKey);

  const stats = useMemo(() => computeRideStats(ride, now), [ride, now]);
  const latestSample = ride.samples.at(-1);
  const userHeadingDegrees =
    latestSample?.headingDegrees ??
    deriveHeadingDegrees(ride.samples.slice(-6)) ??
    null;
  const positionProgressMeters =
    screen === "ride" && route
      ? nearestRouteProgressMeters(route.geometry, userLocation ?? latestSample ?? null)
      : 0;
  const riddenMeters = stats.distanceMeters;
  const navigationProgressMeters =
    screen === "ride" ? Math.max(riddenMeters, positionProgressMeters) : riddenMeters;
  const remainingMeters = route
    ? Math.max(0, route.distanceMeters - navigationProgressMeters)
    : 0;
  const routeProgress = route
    ? Math.min(
        100,
        Math.max(0, (navigationProgressMeters / route.distanceMeters) * 100),
      )
    : 0;
  const etaSeconds =
    route && stats.averageSpeedMps > 0.75
      ? remainingMeters / stats.averageSpeedMps
      : (route?.durationSeconds ?? 0);
  const maneuverProgressMarkers = route
    ? cumulativeManeuverProgressMeters(
        route.maneuvers.map((maneuver) => maneuver.distanceMeters),
      )
    : [];
  const nextManeuverIndex = maneuverProgressMarkers.findIndex(
    (progress) => progress > navigationProgressMeters + 8,
  );
  const nextManeuver =
    nextManeuverIndex >= 0 ? route?.maneuvers[nextManeuverIndex] : route?.maneuvers.at(-1);
  const nextManeuverDistanceMeters =
    nextManeuverIndex >= 0
      ? Math.max(0, maneuverProgressMarkers[nextManeuverIndex] - navigationProgressMeters)
      : 0;
  const nextManeuverEtaSeconds =
    nextManeuverDistanceMeters / Math.max(stats.currentSpeedMps, stats.averageSpeedMps, 1.4);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => saveRide(ride), [ride]);

  useEffect(() => {
    if (route) saveRoute(route);
  }, [route]);

  useEffect(() => {
    if (!hasRoute && screen !== "planner") setScreen("planner");
  }, [hasRoute, screen]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null)
        navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeTarget) return;
    const query = getTargetQuery(activeTarget);
    const controller = new AbortController();

    if (query.trim().length < 3) {
      setSuggestions((current) => ({ ...current, [activeTarget]: [] }));
      return () => controller.abort();
    }

    setSearchingTarget(activeTarget);
    const timeout = window.setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then((places) =>
          setSuggestions((current) => ({ ...current, [activeTarget]: places })),
        )
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          setSuggestions((current) => ({ ...current, [activeTarget]: [] }));
        })
        .finally(() =>
          setSearchingTarget((current) =>
            current === activeTarget ? null : current,
          ),
        );
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeTarget, endQuery, startQuery, stops]);

  async function planRoute() {
    setIsRouting(true);
    setRouteError(null);
    try {
      const nextRoute = await calculateRoute({
        start,
        end,
        waypoints: stops.map((stop) => stop.coordinate),
        mode,
        apiKey,
      });
      setRoute(nextRoute);
    } catch (error) {
      setRouteError(
        error instanceof Error ? error.message : "Route calculation failed.",
      );
    } finally {
      setIsRouting(false);
    }
  }

  function getTargetQuery(target: SearchTarget): string {
    if (target === "start") return startQuery;
    if (target === "end") return endQuery;
    return stops.find((stop) => target === `stop:${stop.id}`)?.query ?? "";
  }

  function markRouteDirty() {
    if (route) setRoute(null);
  }

  function updateQuery(target: SearchTarget, value: string) {
    setActiveTarget(target);
    markRouteDirty();
    if (target === "start") setStartQuery(value);
    else if (target === "end") setEndQuery(value);
    else {
      const id = target.slice(5);
      setStops((current) =>
        current.map((stop) =>
          stop.id === id ? { ...stop, query: value } : stop,
        ),
      );
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setRouteError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinate = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        setUserLocation(coordinate);
        setStart(coordinate);
        setStartQuery("Current location");
        setActiveTarget(null);
        markRouteDirty();
      },
      () => setRouteError("Location permission was blocked or unavailable."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function startRide() {
    if (!route) return;
    setScreen("ride");
    const startedAt = Date.now();
    setRide({ active: true, startedAt, samples: [] });

    if (!navigator.geolocation) return;
    if (watchIdRef.current !== null)
      navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const sample = sampleFromPosition(position);
        setUserLocation({ lat: sample.lat, lon: sample.lon });
        setRide((current) =>
          current.active
            ? {
                ...current,
                samples: [...current.samples, sample],
              }
            : current,
        );
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
    );
  }

  function endRide() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setRide((current) => ({ ...current, active: false, endedAt: Date.now() }));
    setScreen("stats");
  }

  function handleMapClick(coordinate: Coordinate) {
    if (screen !== "planner") return;
    const target = activeTarget ?? "end";
    setCoordinateForTarget(
      target,
      coordinate,
      `${coordinate.lat.toFixed(4)}, ${coordinate.lon.toFixed(4)}`,
    );
  }

  function setCoordinateForTarget(
    target: SearchTarget,
    coordinate: Coordinate,
    label: string,
  ) {
    markRouteDirty();
    if (target === "start") {
      setStart(coordinate);
      setStartQuery(label);
    } else if (target === "end") {
      setEnd(coordinate);
      setEndQuery(label);
    } else {
      const id = target.slice(5);
      setStops((current) =>
        current.map((stop) =>
          stop.id === id ? { ...stop, coordinate, query: label } : stop,
        ),
      );
    }
    setSuggestions((current) => ({ ...current, [target]: [] }));
    setActiveTarget(null);
    window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
  }

  function selectSuggestion(target: SearchTarget, suggestion: PlaceSuggestion) {
    setCoordinateForTarget(target, suggestion.coordinate, suggestion.label);
  }

  function addStop() {
    const midpoint = {
      lat: start.lat + (end.lat - start.lat) / 2,
      lon: start.lon + (end.lon - start.lon) / 2,
    };
    const id = crypto.randomUUID();
    setStops((current) => [
      ...current,
      { id, coordinate: midpoint, query: "New stop" },
    ]);
    setActiveTarget(`stop:${id}`);
    markRouteDirty();
  }

  function removeStop(id: string) {
    setStops((current) => current.filter((stop) => stop.id !== id));
    setSuggestions((current) => {
      const next = { ...current };
      delete next[`stop:${id}`];
      return next;
    });
    if (activeTarget === `stop:${id}`) setActiveTarget(null);
    markRouteDirty();
  }

  function openScreen(target: Screen) {
    if ((target === "ride" || target === "stats") && !hasRoute) return;
    setScreen(target);
  }

  function saveKeyLocally() {
    const trimmed = apiKeyDraft.trim();
    saveOrsApiKey(trimmed);
    setApiKey(trimmed);
    setApiKeyDraft(trimmed);
    setKeyDialogOpen(false);
    markRouteDirty();
  }

  function removeKey() {
    saveOrsApiKey("");
    setApiKey("");
    setApiKeyDraft("");
    setKeyDialogOpen(false);
    markRouteDirty();
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <MapView
          route={route}
          userLocation={userLocation}
          userHeadingDegrees={userHeadingDegrees}
          followUser={screen === "ride"}
          onMapClick={handleMapClick}
        />
        <header className="top-bar">
          <div className="brand-mark">
            <Bike size={21} />
          </div>
          <div>
            <p className="eyebrow">Bike navigation</p>
            <h1>{appConfig.appName}</h1>
          </div>
        </header>

        <button
          className={`key-fab ${hasApiKey ? "configured" : ""}`}
          type="button"
          onClick={() => {
            setApiKeyDraft(apiKey);
            setKeyDialogOpen(true);
          }}
          title={hasApiKey ? "Change routing key" : "Add routing key"}
        >
          <KeyRound size={19} />
        </button>

        {screen === "planner" && (
          <section className="sheet planner-sheet" aria-label="Route planner">
            <div className="mode-row" role="tablist" aria-label="Route mode">
              {(["fastest", "flexible", "safest"] as RouteMode[]).map(
                (item) => {
                  const Icon = modeIcons[item];
                  return (
                    <button
                      key={item}
                      className={`mode-pill ${mode === item ? "selected" : ""}`}
                      onClick={() => {
                        setMode(item);
                        markRouteDirty();
                      }}
                      type="button"
                    >
                      <Icon size={17} />
                      <span>{getModePreset(item).label}</span>
                    </button>
                  );
                },
              )}
            </div>

            <div className="route-points">
              <PlaceSearchField
                label="Start"
                value={startQuery}
                coordinate={start}
                active={activeTarget === "start"}
                loading={searchingTarget === "start"}
                suggestions={suggestions.start ?? []}
                onFocus={() => setActiveTarget("start")}
                onChange={(value) => updateQuery("start", value)}
                onSelect={(suggestion) => selectSuggestion("start", suggestion)}
              />

              {stops.map((stop, index) => {
                const target = `stop:${stop.id}` as const;
                return (
                  <PlaceSearchField
                    key={stop.id}
                    label={`Stop ${index + 1}`}
                    value={stop.query}
                    coordinate={stop.coordinate}
                    active={activeTarget === target}
                    loading={searchingTarget === target}
                    suggestions={suggestions[target] ?? []}
                    removable
                    onFocus={() => setActiveTarget(target)}
                    onChange={(value) => updateQuery(target, value)}
                    onRemove={() => removeStop(stop.id)}
                    onSelect={(suggestion) =>
                      selectSuggestion(target, suggestion)
                    }
                  />
                );
              })}

              <PlaceSearchField
                label="Finish"
                value={endQuery}
                coordinate={end}
                active={activeTarget === "end"}
                loading={searchingTarget === "end"}
                suggestions={suggestions.end ?? []}
                onFocus={() => setActiveTarget("end")}
                onChange={(value) => updateQuery("end", value)}
                onSelect={(suggestion) => selectSuggestion("end", suggestion)}
              />
            </div>

            <div className="planner-actions">
              <button
                className="icon-button"
                type="button"
                onClick={useCurrentLocation}
                title="Use current location"
              >
                <LocateFixed size={20} />
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={addStop}
              >
                <Plus size={18} />
                <span>Stop</span>
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={planRoute}
                disabled={isRouting}
              >
                <Route size={19} />
                <span>{isRouting ? "Planning..." : "Plan route"}</span>
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!hasRoute}
                onClick={startRide}
              >
                <Navigation size={18} />
                <span>Ride</span>
              </button>
            </div>

            {routeError && <p className="status-text error">{routeError}</p>}
            {route && (
              <div className="route-summary">
                <Metric
                  icon={MapPinned}
                  label="Distance"
                  value={formatDistance(route.distanceMeters)}
                />
                <Metric
                  icon={Clock3}
                  label="ETA"
                  value={formatDuration(route.durationSeconds)}
                />
                <Metric
                  icon={Flag}
                  label="Stops"
                  value={`${route.waypoints?.length ?? 0}`}
                />
              </div>
            )}
            <p className="provider-note">
              {route
                ? `${route.provider}. Search uses OpenStreetMap Nominatim.`
                : `Search places, add stops, or tap the map to set ${activeTarget ?? "finish"}. ${hasApiKey ? "Real routing is enabled." : "Demo routes are active until you add a key."}`}
            </p>
          </section>
        )}

        {screen === "ride" && hasRoute && (
          <section className="ride-panel" aria-label="Active ride">
            <div className="speed-card">
              <div>
                <p className="eyebrow">Current speed</p>
                <strong>{formatSpeed(stats.currentSpeedMps)}</strong>
              </div>
              <Gauge size={34} />
            </div>
            <div className="progress-track" aria-label="Route progress">
              <span style={{ width: `${routeProgress}%` }} />
            </div>
            <div className="maneuver-card">
              <Compass size={25} />
              <div>
                <p className="eyebrow">Next</p>
                <h2>
                  {nextManeuver?.instruction ?? "Stay on the highlighted route"}
                </h2>
                <p className="maneuver-meta">
                  {nextManeuverDistanceMeters > 0
                    ? `${formatDistance(nextManeuverDistanceMeters)} · ${formatDuration(nextManeuverEtaSeconds)}`
                    : "Arriving now"}
                </p>
              </div>
            </div>
            <div className="computer-grid">
              <Metric
                icon={MapPinned}
                label="Remaining"
                value={formatDistance(remainingMeters)}
              />
              <Metric
                icon={Timer}
                label="ETA"
                value={formatDuration(etaSeconds)}
              />
              <Metric
                icon={Bike}
                label="Average"
                value={formatSpeed(stats.averageSpeedMps)}
              />
              <Metric
                icon={Zap}
                label="Max"
                value={formatSpeed(stats.maxSpeedMps)}
              />
              <Metric
                icon={Activity}
                label="Ridden"
                value={formatDistance(riddenMeters)}
              />
              <Metric
                icon={Clock3}
                label="Elapsed"
                value={formatDuration(stats.elapsedSeconds)}
              />
            </div>
            <button className="danger-button" type="button" onClick={endRide}>
              End ride
            </button>
          </section>
        )}

        {screen === "stats" && hasRoute && (
          <section className="sheet stats-sheet" aria-label="Ride stats">
            <div className="stats-header">
              <div>
                <p className="eyebrow">Ride computer</p>
                <h2>{ride.active ? "Live stats" : "Last ride"}</h2>
              </div>
              <Activity size={26} />
            </div>
            <div className="stats-grid">
              <Metric
                icon={Gauge}
                label="Current"
                value={formatSpeed(stats.currentSpeedMps)}
              />
              <Metric
                icon={Bike}
                label="Average"
                value={formatSpeed(stats.averageSpeedMps)}
              />
              <Metric
                icon={Zap}
                label="Max"
                value={formatSpeed(stats.maxSpeedMps)}
              />
              <Metric
                icon={MapPinned}
                label="Ridden"
                value={formatDistance(riddenMeters)}
              />
              <Metric
                icon={Flag}
                label="Remaining"
                value={formatDistance(remainingMeters)}
              />
              <Metric
                icon={Timer}
                label="ETA"
                value={formatDuration(etaSeconds)}
              />
              <Metric
                icon={Clock3}
                label="Elapsed"
                value={formatDuration(stats.elapsedSeconds)}
              />
              <Metric
                icon={Activity}
                label="Route climb"
                value={`${Math.round(route?.elevationGainMeters ?? 0)} m`}
              />
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        <NavButton
          active={screen === "planner"}
          label="Plan"
          icon={Route}
          onClick={() => openScreen("planner")}
        />
        <NavButton
          active={screen === "ride"}
          label="Ride"
          icon={Navigation}
          disabled={!hasRoute}
          onClick={() => openScreen("ride")}
        />
        <NavButton
          active={screen === "stats"}
          label="Stats"
          icon={Activity}
          disabled={!hasRoute}
          onClick={() => openScreen("stats")}
        />
      </nav>

      {keyDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="key-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="key-dialog-title"
          >
            <button
              className="dialog-close"
              type="button"
              onClick={() => setKeyDialogOpen(false)}
              title="Close"
            >
              <X size={18} />
            </button>
            <div className="dialog-icon">
              <KeyRound size={24} />
            </div>
            <p className="eyebrow">Bring your own key</p>
            <h2 id="key-dialog-title">Enable real bike routing</h2>
            <p className="dialog-copy">
              Paste an OpenRouteService API key to calculate real cycling
              routes. It is saved only in this browser. Without a key, Velo uses
              local demo routes.
            </p>
            <label className="key-entry">
              <span>OpenRouteService API key</span>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder="ors_..."
                autoComplete="off"
                autoFocus
              />
            </label>
            <div className="dialog-actions">
              <button
                className="primary-button"
                type="button"
                onClick={saveKeyLocally}
              >
                Save key
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setKeyDialogOpen(false)}
              >
                Use demo
              </button>
              {hasApiKey && (
                <button
                  className="text-danger-button"
                  type="button"
                  onClick={removeKey}
                >
                  Remove key
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PlaceSearchField({
  label,
  value,
  coordinate,
  active,
  loading,
  suggestions,
  removable = false,
  onFocus,
  onChange,
  onSelect,
  onRemove,
}: {
  label: string;
  value: string;
  coordinate: Coordinate;
  active: boolean;
  loading: boolean;
  suggestions: PlaceSuggestion[];
  removable?: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
  onRemove?: () => void;
}) {
  return (
    <div className={`place-field ${active ? "active" : ""}`}>
      <label>
        <span>{label}</span>
        <div className="place-input-row">
          <Search size={17} />
          <input
            value={value}
            onFocus={onFocus}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Escape" &&
                document.activeElement instanceof HTMLElement
              ) {
                document.activeElement.blur();
              }
            }}
            placeholder={`Search ${label.toLowerCase()}`}
          />
          {removable && (
            <button
              className="mini-icon-button"
              type="button"
              onClick={onRemove}
              title={`Remove ${label}`}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </label>
      <p>
        {coordinate.lat.toFixed(4)}, {coordinate.lon.toFixed(4)}
      </p>
      {active && (loading || suggestions.length > 0) && (
        <div className="suggestion-list">
          {loading && <div className="suggestion-row muted">Searching...</div>}
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              className="suggestion-row"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(suggestion)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NavButton({
  active,
  label,
  icon: Icon,
  disabled = false,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ComponentType<{ size?: number }>;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-button ${active ? "active" : ""}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={21} />
      <span>{label}</span>
    </button>
  );
}
