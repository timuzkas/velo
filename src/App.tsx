import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bike,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Flag,
  Gauge,
  Home,
  KeyRound,
  LocateFixed,
  MapPinned,
  Navigation,
  Plus,
  RotateCcw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  Pencil,
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
  clearRoute,
  loadOrsApiKey,
  loadRide,
  loadRoute,
  loadSavedPlaces,
  loadSavedRoutes,
  saveOrsApiKey,
  saveRide,
  saveRoute,
  saveSavedPlace,
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
type PlaceEditTarget = "home" | "work";
type SavedPlaceOption = {
  kind: PlaceEditTarget;
  label: string;
  value?: string;
  coordinate?: Coordinate;
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

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
  const [collapsedScreen, setCollapsedScreen] = useState<Screen | null>(null);
  const [route, setRoute] = useState<BikeRoute | null>(() => loadRoute());
  const [completedRoute, setCompletedRoute] = useState<BikeRoute | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<BikeRoute[]>(() => loadSavedRoutes());
  const [savedPlaces, setSavedPlaces] = useState(() => loadSavedPlaces());
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [placeEditTarget, setPlaceEditTarget] = useState<PlaceEditTarget | null>(null);
  const [placeEditQuery, setPlaceEditQuery] = useState("");
  const [mobileSearchTarget, setMobileSearchTarget] = useState<SearchTarget | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ride, setRide] = useState<RideState>(
    () => loadRide() ?? { active: false, samples: [] },
  );
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [rideFollowing, setRideFollowing] = useState(true);
  const watchIdRef = useRef<number | null>(null);
  const hasRoute = Boolean(route);
  const statsRoute = route ?? completedRoute;
  const canShowStats = Boolean(route || (screen === "stats" && completedRoute));
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
    if (route) setSavedRoutes(loadSavedRoutes());
  }, [route]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (!hasRoute && !completedRoute && screen !== "planner") setScreen("planner");
  }, [completedRoute, hasRoute, screen]);

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
      setSavedRoutes(loadSavedRoutes());
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

  function beginPlaceEdit(kind: PlaceEditTarget) {
    const place = savedPlaces[kind];
    setPlaceEditTarget(kind);
    setPlaceEditQuery(place?.label ?? "");
    setActiveTarget(null);
  }

  async function searchAndSavePlace(kind: PlaceEditTarget) {
    const [place] = await searchPlaces(placeEditQuery);
    if (!place) return;
    savePlace(kind, place.coordinate, place.label);
    setPlaceEditTarget(null);
    setPlaceEditQuery("");
  }

  function savedPlaceOptions(): SavedPlaceOption[] {
    return (["home", "work"] as const).map((kind) => ({
      kind,
      label: kind === "home" ? "Home" : "Work",
      value: savedPlaces[kind]?.label,
      coordinate: savedPlaces[kind]?.coordinate,
    }));
  }

  function selectSavedPlace(target: SearchTarget, option: SavedPlaceOption) {
    if (!option.coordinate) {
      beginPlaceEdit(option.kind);
      setMobileSearchTarget(null);
      return;
    }
    setCoordinateForTarget(target, option.coordinate, option.value ?? option.label);
    setMobileSearchTarget(null);
  }

  function openSearchTarget(target: SearchTarget) {
    setActiveTarget(target);
    if (window.matchMedia("(max-width: 640px)").matches) {
      setMobileSearchTarget(target);
    }
  }

  function closeMobileSearch() {
    setMobileSearchTarget(null);
    setActiveTarget(null);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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

  function startRide(routeToRide = route) {
    if (!routeToRide) return;
    setRoute(routeToRide);
    setScreen("ride");
    setRideFollowing(true);
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

  function loadSavedRoute(savedRoute: BikeRoute, targetScreen: Screen = "planner") {
    setRoute(savedRoute);
    setMode(savedRoute.mode);
    setStart(savedRoute.geometry[0] ?? start);
    setEnd(savedRoute.geometry.at(-1) ?? end);
    setStartQuery("Saved start");
    setEndQuery("Saved finish");
    setStops(
      savedRoute.waypoints.map((coordinate, index) => ({
        id: crypto.randomUUID(),
        coordinate,
        query: `Saved stop ${index + 1}`,
      })),
    );
    setCollapsedScreen(null);
    setScreen(targetScreen);
  }

  function endRide() {
    const routeSnapshot = route;
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setRide((current) => ({ ...current, active: false, endedAt: Date.now() }));
    clearRoute();
    setCompletedRoute(routeSnapshot);
    setRoute(null);
    setRideFollowing(true);
    setCollapsedScreen(null);
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
    setMobileSearchTarget(null);
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
    if (screen === "stats" && completedRoute && !hasRoute) {
      if (target === "stats") return;
      setCompletedRoute(null);
      setCollapsedScreen(null);
      setScreen(target === "ride" ? "planner" : target);
      return;
    }
    if (target === "ride" && !hasRoute) return;
    if (target === "stats" && !canShowStats) return;
    if (screen === target) {
      setCollapsedScreen((current) => (current === target ? null : target));
      return;
    }
    setCollapsedScreen(null);
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

  function savePlace(kind: PlaceEditTarget, coordinate: Coordinate, label: string) {
    const nextPlaces = saveSavedPlace(kind, { coordinate, label });
    setSavedPlaces(nextPlaces);
  }

  async function promptInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
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
          followUser={screen === "ride" && rideFollowing}
          onUserPan={() => {
            if (screen === "ride") setRideFollowing(false);
          }}
          onMapClick={handleMapClick}
        />
        <header className="top-bar">
          <div className="brand-mark">
            <Bike size={21} />
          </div>
          <div>
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

        {installPrompt && (
          <button className="install-fab" type="button" onClick={promptInstall}>
            Install
          </button>
        )}

        {screen === "planner" && collapsedScreen !== "planner" && (
          <section className="sheet planner-sheet" aria-label="Route planner">
            <div className="route-points">
              <PlaceSearchField
                label="Start"
                value={startQuery}
                coordinate={start}
                active={activeTarget === "start"}
                loading={searchingTarget === "start"}
                suggestions={suggestions.start ?? []}
                savedOptions={savedPlaceOptions()}
                onFocus={() => openSearchTarget("start")}
                onBlur={() => setActiveTarget((current) => (current === "start" ? null : current))}
                onChange={(value) => updateQuery("start", value)}
                onSelect={(suggestion) => selectSuggestion("start", suggestion)}
                onSavedSelect={(option) => selectSavedPlace("start", option)}
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
                    savedOptions={savedPlaceOptions()}
                    removable
                    onFocus={() => openSearchTarget(target)}
                    onBlur={() => setActiveTarget((current) => (current === target ? null : current))}
                    onChange={(value) => updateQuery(target, value)}
                    onRemove={() => removeStop(stop.id)}
                    onSelect={(suggestion) =>
                      selectSuggestion(target, suggestion)
                    }
                    onSavedSelect={(option) => selectSavedPlace(target, option)}
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
                savedOptions={savedPlaceOptions()}
                onFocus={() => openSearchTarget("end")}
                onBlur={() => setActiveTarget((current) => (current === "end" ? null : current))}
                onChange={(value) => updateQuery("end", value)}
                onSelect={(suggestion) => selectSuggestion("end", suggestion)}
                onSavedSelect={(option) => selectSavedPlace("end", option)}
              />

              <button className="add-stop-button" type="button" onClick={addStop}>
                <Plus size={18} />
                <span>Add stop</span>
              </button>
            </div>

            <div className="planner-divider" />

            <div className="planner-tools">
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
                        <Icon size={15} />
                        <span>{getModePreset(item).label}</span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <div className="planner-divider" />

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
                onClick={() => startRide()}
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
            {route && savedRoutes.length > 0 && (
              <div className="saved-routes">
                <button
                  className="section-toggle"
                  type="button"
                  onClick={() => setRecentExpanded((expanded) => !expanded)}
                >
                  {recentExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span>Recent routes</span>
                  <strong>{savedRoutes.length}</strong>
                </button>
                {recentExpanded &&
                  savedRoutes.slice(0, 3).map((savedRoute) => (
                    <div key={savedRoute.id} className="saved-route-row">
                      <button
                        className="saved-route-main"
                        type="button"
                        onClick={() => loadSavedRoute(savedRoute)}
                      >
                        <Route size={17} />
                        <span>{formatDistance(savedRoute.distanceMeters)}</span>
                        <strong>{formatDuration(savedRoute.durationSeconds)}</strong>
                      </button>
                      <button
                        className="mini-icon-button"
                        type="button"
                        onClick={() => {
                          loadSavedRoute(savedRoute, "ride");
                          startRide(savedRoute);
                        }}
                        title="Restart route"
                      >
                        <RotateCcw size={15} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <p className="provider-note">
              {route
                ? `${route.provider}. Search uses OpenStreetMap Nominatim.`
                : `Search places, add stops, or tap the map to set ${activeTarget ?? "finish"}. ${hasApiKey ? "Real routing is enabled." : "Demo routes are active until you add a key."}`}
            </p>
          </section>
        )}

        {collapsedScreen && (
          <button
            className="collapsed-route-chip"
            type="button"
            onClick={() => setCollapsedScreen(null)}
          >
            {collapsedScreen === "planner" && <Route size={18} />}
            {collapsedScreen === "ride" && <Navigation size={18} />}
            {collapsedScreen === "stats" && <Activity size={18} />}
            <span>{collapsedScreen === "planner" ? "Planner" : collapsedScreen === "ride" ? "Ride" : "Stats"}</span>
            {route && <strong>{formatDistance(route.distanceMeters)}</strong>}
          </button>
        )}

        {screen === "ride" && hasRoute && collapsedScreen !== "ride" && (
          <section className="ride-panel" aria-label="Active ride">
            {!rideFollowing && (
              <button className="recenter-button" type="button" onClick={() => setRideFollowing(true)}>
                <LocateFixed size={17} />
                <span>Re-center</span>
              </button>
            )}
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
            <div className="progress-track" aria-label="Route progress">
              <span style={{ width: `${routeProgress}%` }} />
            </div>
            <div className="ride-guidance-row">
              <Metric
                icon={Timer}
                label="ETA"
                value={formatDuration(etaSeconds)}
              />
              <Metric
                icon={MapPinned}
                label="Left"
                value={formatDistance(remainingMeters)}
              />
            </div>
            <button className="danger-button" type="button" onClick={endRide}>
              End ride
            </button>
          </section>
        )}

        {screen === "stats" && statsRoute && collapsedScreen !== "stats" && (
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
                value={`${Math.round(statsRoute.elevationGainMeters ?? 0)} m`}
              />
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        <NavButton
          active={screen === "planner" && collapsedScreen !== "planner"}
          label="Plan"
          icon={Route}
          onClick={() => openScreen("planner")}
        />
        <NavButton
          active={screen === "ride" && collapsedScreen !== "ride"}
          label="Ride"
          icon={Navigation}
          disabled={!hasRoute}
          onClick={() => openScreen("ride")}
        />
        <NavButton
          active={screen === "stats" && collapsedScreen !== "stats"}
          label="Stats"
          icon={Activity}
          disabled={!canShowStats}
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
            <h2 id="key-dialog-title">Enable ORS routing</h2>
            <p className="dialog-copy">
              Paste an OpenRouteService API key to have working navigation in the app. It is saved only in this browser. Without a key, Velo uses local demo routes.
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

      {placeEditTarget && (
        <div className="dialog-backdrop" role="presentation">
          <section className="key-dialog place-dialog" role="dialog" aria-modal="true">
            <button
              className="dialog-close"
              type="button"
              onClick={() => setPlaceEditTarget(null)}
              title="Close"
            >
              <X size={18} />
            </button>
            <div className="dialog-icon">
              {placeEditTarget === "home" ? <Home size={24} /> : <MapPinned size={24} />}
            </div>
            <p className="eyebrow">Saved place</p>
            <h2>Set {placeEditTarget === "home" ? "Home" : "Work"}</h2>
            <p className="dialog-copy">Search for a place and save it locally. It will appear inside route search suggestions.</p>
            <label className="key-entry">
              <span>{placeEditTarget === "home" ? "Home" : "Work"} location</span>
              <input
                value={placeEditQuery}
                onChange={(event) => setPlaceEditQuery(event.target.value)}
                placeholder="Search a place"
                autoFocus
              />
            </label>
            <div className="dialog-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void searchAndSavePlace(placeEditTarget)}
              >
                Save place
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPlaceEditTarget(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}

      {mobileSearchTarget && (
        <MobileSearchOverlay
          label={
            mobileSearchTarget === "start"
              ? "Start"
              : mobileSearchTarget === "end"
                ? "Finish"
                : "Stop"
          }
          value={getTargetQuery(mobileSearchTarget)}
          loading={searchingTarget === mobileSearchTarget}
          savedOptions={savedPlaceOptions()}
          suggestions={suggestions[mobileSearchTarget] ?? []}
          onChange={(value) => updateQuery(mobileSearchTarget, value)}
          onSelect={(suggestion) => selectSuggestion(mobileSearchTarget, suggestion)}
          onSavedSelect={(option) => selectSavedPlace(mobileSearchTarget, option)}
          onClose={closeMobileSearch}
        />
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
  savedOptions = [],
  removable = false,
  onFocus,
  onBlur,
  onChange,
  onSelect,
  onSavedSelect,
  onRemove,
}: {
  label: string;
  value: string;
  coordinate: Coordinate;
  active: boolean;
  loading: boolean;
  suggestions: PlaceSuggestion[];
  savedOptions?: SavedPlaceOption[];
  removable?: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
  onSavedSelect: (option: SavedPlaceOption) => void;
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
            onBlur={onBlur}
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
      {active && (loading || suggestions.length > 0 || savedOptions.length > 0) && (
        <div className="suggestion-list">
          <div className="suggestion-pills" aria-label="Quick destinations">
            {savedOptions.map((option) => (
              <button
                key={option.kind}
                className={`suggestion-pill ${option.coordinate ? "" : "unset"}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSavedSelect(option)}
              >
                {option.kind === "home" ? <Home size={15} /> : <MapPinned size={15} />}
                <span>{option.label}</span>
                {option.value ? (
                  <small>{option.value}</small>
                ) : (
                  <small className="edit-place-icon" aria-label={`Set ${option.label}`}>
                    <Pencil size={13} />
                  </small>
                )}
              </button>
            ))}
          </div>
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

function MobileSearchOverlay({
  label,
  value,
  loading,
  savedOptions,
  suggestions,
  onChange,
  onSelect,
  onSavedSelect,
  onClose,
}: {
  label: string;
  value: string;
  loading: boolean;
  savedOptions: SavedPlaceOption[];
  suggestions: PlaceSuggestion[];
  onChange: (value: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
  onSavedSelect: (option: SavedPlaceOption) => void;
  onClose: () => void;
}) {
  return (
    <div className="mobile-search-overlay" role="dialog" aria-modal="true">
      <div className="mobile-search-bar">
        <button className="mini-icon-button" type="button" onClick={onClose} title="Close search">
          <X size={18} />
        </button>
        <label>
          <span>{label}</span>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            autoFocus
          />
        </label>
      </div>

      <div className="mobile-quick-pills">
        {savedOptions.map((option) => (
          <button
            key={option.kind}
            className={option.coordinate ? "" : "unset"}
            type="button"
            onClick={() => onSavedSelect(option)}
          >
            {option.kind === "home" ? <Home size={16} /> : <MapPinned size={16} />}
            <span>{option.label}</span>
            {option.value ? (
              <small>{option.value}</small>
            ) : (
              <small className="edit-place-icon" aria-label={`Set ${option.label}`}>
                <Pencil size={13} />
              </small>
            )}
          </button>
        ))}
      </div>

      <div className="mobile-suggestion-list">
        {loading && <div className="suggestion-row muted">Searching...</div>}
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            className="suggestion-row"
            type="button"
            onClick={() => onSelect(suggestion)}
          >
            <span>{suggestion.label}</span>
            <small>Nearby</small>
          </button>
        ))}
      </div>
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
