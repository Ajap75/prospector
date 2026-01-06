// ProspectionPage.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { GeoJsonObject } from "geojson";

import type { Note, Target, Zone } from "../types";
import TargetList from "../components/TargetList";
import MapView from "../components/MapView";
import NotesPanel from "../components/NotesPanel";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const TOUR_MAX = 8;
const TOUR_STORAGE_KEY = (zoneId: number) => `prospector:tour:${zoneId}`;

function normalizeTourIds(raw: unknown, allTargets: Target[], max = TOUR_MAX): number[] {
  if (!Array.isArray(raw)) return [];

  const byId = new Map(allTargets.map((t) => [t.id, t]));
  const cleaned: number[] = [];

  for (const x of raw) {
    if (typeof x !== "number") continue;
    const t = byId.get(x);
    if (!t) continue;
    if (t.status !== "non_traite") continue; // tournée = actionnables only
    if (cleaned.includes(x)) continue;
    cleaned.push(x);
    if (cleaned.length >= max) break;
  }
  return cleaned;
}

export default function ProspectionPage() {
  // --- Core state ---
  const [targets, setTargets] = useState<Target[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneId, setZoneId] = useState<number>(1);

  // --- Notes state ---
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteContent, setNoteContent] = useState("");
  const [notePinned, setNotePinned] = useState(false);

  // --- Zone overlay ---
  const [zoneGeoJson, setZoneGeoJson] = useState<GeoJsonObject | null>(null);

  // --- Tour state (single source of truth: tourIds) ---
  const [tourIds, setTourIds] = useState<number[]>([]);
  const [tourLoading, setTourLoading] = useState(false);

  // ✅ persistence guard: prevents overwriting localStorage with []
  const [tourHydrated, setTourHydrated] = useState(false);

  // ✅ Focus + Hover
  const [focusedTargetId, setFocusedTargetId] = useState<number | null>(null); // persist
  const [hoveredTargetId, setHoveredTargetId] = useState<number | null>(null); // transient
  const highlightedTargetId = hoveredTargetId ?? focusedTargetId;

  // ---------------------------------------------------------------------------
  // Status rules (MVP)
  // ---------------------------------------------------------------------------
  const isRepasserDue = (t: Target) =>
    t.status === "done_repasser" &&
    !!t.next_action_at &&
    new Date(t.next_action_at).getTime() <= Date.now();

  // ✅ Actifs = non_traite + done_repasser (dû)
  const activeTargets = useMemo(() => targets.filter((t) => t.status === "non_traite" || isRepasserDue(t)), [targets]);

  // ✅ Inactifs = done / ignore / done_repasser (pas encore dû)
  const inactiveTargets = useMemo(
    () =>
      targets.filter((t) => {
        if (t.status === "done" || t.status === "ignore") return true;
        if (t.status === "done_repasser" && !isRepasserDue(t)) return true;
        return false;
      }),
    [targets]
  );

  // ✅ Carte = seulement non_traite (actionnables)
  const actionableTargetsForMap = useMemo(() => targets.filter((t) => t.status === "non_traite"), [targets]);

  // ---------------------------------------------------------------------------
  // Tour helpers
  // ---------------------------------------------------------------------------
  const isTourEligible = (t: Target) => t.status === "non_traite";

  const distance2 = (a: Target, b: Target) => {
    const dx = a.longitude - b.longitude;
    const dy = a.latitude - b.latitude;
    return dx * dx + dy * dy;
  };

  const toLineString = (ids: number[]): GeoJsonObject | null => {
    if (ids.length < 2) return null;

    const coords: [number, number][] = [];
    for (const id of ids) {
      const t = targets.find((x) => x.id === id);
      if (!t) continue;
      coords.push([t.longitude, t.latitude]); // GeoJSON = [lng, lat]
    }
    if (coords.length < 2) return null;

    return { type: "LineString", coordinates: coords } as unknown as GeoJsonObject;
  };

  const tourPolyline = useMemo(() => toLineString(tourIds), [tourIds, targets]);

  function removeFromTour(id: number) {
    setTourHydrated(true);
    setTourIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev));
  }

  const addToTour = (id: number) => {
    setTourHydrated(true);
    setTourIds((prev) => {
      if (prev.includes(id)) return prev;
      if (prev.length >= TOUR_MAX) return prev;

      const tNew = targets.find((x) => x.id === id);
      if (!tNew || !isTourEligible(tNew)) return prev;

      if (prev.length === 0) return [id];

      const tourTargets: Target[] = prev
        .map((tid) => targets.find((x) => x.id === tid))
        .filter(Boolean) as Target[];

      if (tourTargets.length !== prev.length) {
        return [...prev, id].slice(0, TOUR_MAX);
      }

      let bestIdx = 0;
      let bestDelta = Number.POSITIVE_INFINITY;

      // beginning
      {
        const delta = distance2(tNew, tourTargets[0]);
        bestDelta = delta;
        bestIdx = 0;
      }

      // middle
      for (let i = 0; i < tourTargets.length - 1; i++) {
        const A = tourTargets[i];
        const B = tourTargets[i + 1];
        const delta = distance2(A, tNew) + distance2(tNew, B) - distance2(A, B);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i + 1;
        }
      }

      // end
      {
        const A = tourTargets[tourTargets.length - 1];
        const delta = distance2(A, tNew);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = tourTargets.length;
        }
      }

      return [...prev.slice(0, bestIdx), id, ...prev.slice(bestIdx)].slice(0, TOUR_MAX);
    });
  };

  // ---------------------------------------------------------------------------
  // Auto tour (backend = suggestion) + reset
  // ---------------------------------------------------------------------------
  const startAutoTour = async () => {
    // Toggle behavior: if tour exists => reset
    if (tourIds.length > 0) {
      setTourHydrated(true);
      try {
        localStorage.removeItem(TOUR_STORAGE_KEY(zoneId));
      } catch {
        // ignore
      }
      setTourIds([]);
      return;
    }

    try {
      setTourLoading(true);

      const res = await fetch(`${API_BASE}/route/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_id: zoneId }),
      });

      if (!res.ok) {
        alert("Impossible de générer une tournée automatique pour cette zone.");
        return;
      }

      const data = await res.json();
      const rawIds: unknown = data.target_ids_ordered ?? [];

      const normalized = normalizeTourIds(rawIds, targets, TOUR_MAX);

      if (normalized.length === 0) {
        alert("Impossible de générer une tournée automatique pour cette zone.");
        return;
      }

      setTourHydrated(true);
      setTourIds(normalized);
    } catch (e) {
      console.error("POST /route/auto failed", e);
      alert("Impossible de générer une tournée automatique pour cette zone.");
    } finally {
      setTourLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Google Maps url (no API)
  // ---------------------------------------------------------------------------
  const buildGoogleMapsUrl = (ids: number[], allTargets: Target[]): string | null => {
    if (!Array.isArray(ids) || ids.length === 0) return null;

    const byId = new Map(allTargets.map((t) => [t.id, t]));
    const pts: string[] = [];

    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      if (typeof t.latitude !== "number" || typeof t.longitude !== "number") continue;
      pts.push(`${t.latitude},${t.longitude}`);
    }

    if (pts.length === 0) return null;

    if (pts.length === 1) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pts[0])}`;
    }

    const origin = pts[0];
    const destination = pts[pts.length - 1];
    const mids = pts.slice(1, -1);

    const base =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}` +
      `&travelmode=walking`;

    return mids.length > 0 ? `${base}&waypoints=${encodeURIComponent(mids.join("|"))}` : base;
  };

  const googleMapsUrl = useMemo(() => buildGoogleMapsUrl(tourIds, targets), [tourIds, targets]);

  const openTourInGoogleMaps = () => {
    if (!googleMapsUrl) {
      alert("Ajoute au moins 1 point dans la tournée.");
      return;
    }
    window.open(googleMapsUrl, "_blank", "noopener,noreferrer");
  };

  // ---------------------------------------------------------------------------
  // Tour ordering (active list tour-first)
  // ---------------------------------------------------------------------------
  const tourSet = useMemo(() => new Set(tourIds), [tourIds]);

  const activeTargetsTourFirst = useMemo(() => {
    if (tourIds.length === 0) return activeTargets;

    const byId = new Map(activeTargets.map((t) => [t.id, t]));
    const tourOrdered: Target[] = [];
    for (const id of tourIds) {
      const t = byId.get(id);
      if (t) tourOrdered.push(t);
    }

    const rest = activeTargets.filter((t) => !tourSet.has(t.id));
    return [...tourOrdered, ...rest];
  }, [activeTargets, tourIds, tourSet]);

  // ---------------------------------------------------------------------------
  // Load zones once
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadZones() {
      try {
        const res = await fetch(`${API_BASE}/zones`, { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        const items: Zone[] = data.items ?? [];

        if (cancelled) return;

        setZones(items);
        if (items.length > 0) setZoneId((prev) => (prev ? prev : items[0].id));
      } catch (e) {
        console.error("Fetch /zones failed", e);
      }
    }

    void loadZones();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Load targets when zone changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadTargets() {
      try {
        // Reset UI + prevent early save overwrite
        setFocusedTargetId(null);
        setHoveredTargetId(null);
        setTourIds([]);
        setTargets([]);
        setTourHydrated(false); // ✅ critical

        const res = await fetch(`${API_BASE}/dpe?zone_id=${zoneId}`, { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        const items: Target[] = data.items ?? [];

        if (!cancelled) setTargets(items);
      } catch (e) {
        console.error("Fetch /dpe failed", e);
      }
    }

    if (zoneId) void loadTargets();
    return () => {
      cancelled = true;
    };
  }, [zoneId]);

  // ---------------------------------------------------------------------------
  // Load zone GeoJSON overlay when zone changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadZoneGeo() {
      try {
        setZoneGeoJson(null);

        const res = await fetch(`${API_BASE}/zones/${zoneId}`, { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        const geojsonStr: string | undefined = data?.item?.geojson;
        if (!geojsonStr) return;

        const parsed = JSON.parse(geojsonStr) as GeoJsonObject;
        if (!cancelled) setZoneGeoJson(parsed);
      } catch (e) {
        console.error("Failed to load zone geojson:", e);
      }
    }

    if (zoneId) void loadZoneGeo();
    return () => {
      cancelled = true;
    };
  }, [zoneId]);

  // ---------------------------------------------------------------------------
  // ✅ Restore tour once after targets are loaded, then mark hydrated
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!zoneId) return;
    if (targets.length === 0) return;
    if (tourHydrated) return;

    try {
      const raw = localStorage.getItem(TOUR_STORAGE_KEY(zoneId));
      if (raw) {
        const parsed = JSON.parse(raw);
        const restored = normalizeTourIds(parsed, targets, TOUR_MAX);
        if (restored.length > 0) setTourIds(restored);
      }
    } catch {
      // ignore
    } finally {
      setTourHydrated(true);
    }
  }, [zoneId, targets, tourHydrated]);

  // ---------------------------------------------------------------------------
  // ✅ Save only after hydration (prevents [] overwrite on refresh)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!zoneId) return;
    if (!tourHydrated) return;

    try {
      localStorage.setItem(TOUR_STORAGE_KEY(zoneId), JSON.stringify(tourIds));
    } catch {
      // ignore
    }
  }, [zoneId, tourIds, tourHydrated]);

  // ---------------------------------------------------------------------------
  // Status updates
  // ---------------------------------------------------------------------------
  const updateStatus = async (id: number, status: Target["status"], nextActionAt: string | null = null) => {
    const body: Record<string, unknown> = { status };
    if (status === "done_repasser") body.next_action_at = nextActionAt;

    const res = await fetch(`${API_BASE}/dpe/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      alert("Erreur backend : statut non mis à jour");
      return;
    }

    setTargets((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status, next_action_at: status === "done_repasser" ? nextActionAt : null }
          : t
      )
    );

    if (status !== "non_traite") {
      removeFromTour(id);
      if (focusedTargetId === id) setFocusedTargetId(null);
      if (hoveredTargetId === id) setHoveredTargetId(null);
    }
  };

  const repasserInDays = async (id: number, days: number) => {
    const next = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await updateStatus(id, "done_repasser", next);
  };

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------
  const loadNotes = async (address: string) => {
    const res = await fetch(`${API_BASE}/notes?address=${encodeURIComponent(address)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    setNotes(data.items ?? []);
  };

  const openAddressNotes = async (address: string) => {
    setSelectedAddress(address);
    await loadNotes(address);
  };

  const closeNotes = () => {
    setSelectedAddress(null);
    setNotes([]);
    setNoteContent("");
    setNotePinned(false);
  };

  const createNote = async () => {
    if (!selectedAddress) return;

    const content = noteContent.trim();
    if (!content) return;

    const res = await fetch(`${API_BASE}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: selectedAddress,
        content,
        pinned: notePinned,
      }),
    });

    if (!res.ok) {
      alert("Erreur : note non enregistrée");
      return;
    }

    setNoteContent("");
    setNotePinned(false);
    await loadNotes(selectedAddress);
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  return (
    <main className="p-10 space-y-10">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold">PROSPECTOR</h1>

        <div className="flex items-center gap-3">
          <label className="font-medium">Zone :</label>
          <select
            className="border rounded px-3 py-2"
            value={zoneId}
            onChange={(e) => setZoneId(Number(e.target.value))}
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
        {/* Colonne gauche: LISTE */}
        <div className="space-y-8">
          <TargetList
            activeTargets={activeTargetsTourFirst}
            inactiveTargets={inactiveTargets}
            tourIds={tourIds}
            tourLoading={tourLoading}
            onAutoTour={startAutoTour}
            onOpenGoogleMaps={openTourInGoogleMaps}
            googleMapsUrl={googleMapsUrl}
            onAddToTour={addToTour}
            onRemoveFromTour={removeFromTour}
            onDone={(id) => updateStatus(id, "done")}
            onRepasser={(id, days) => repasserInDays(id, days)}
            onIgnore={(id) => updateStatus(id, "ignore")}
            onReset={(id) => updateStatus(id, "non_traite")}
            onOpenNotes={openAddressNotes}
            onFocusTarget={(id) => setFocusedTargetId(id)}
            focusedTargetId={highlightedTargetId}
          />
        </div>

        {/* Colonne droite: CARTE + NOTES */}
        <div className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Carte (orientation)</h2>
            <MapView
              targets={actionableTargetsForMap}
              onOpenNotes={openAddressNotes}
              onAddToTour={addToTour}
              onRemoveFromTour={removeFromTour}
              tourIds={tourIds}
              tourPolyline={tourPolyline}
              maxPins={60}
              zoneGeoJson={zoneGeoJson}
              focusedTargetId={focusedTargetId}
              highlightedTargetId={highlightedTargetId}
              onHoverTarget={setHoveredTargetId}
            />
          </div>

          {/* Notes panel sous la carte */}
          {selectedAddress ? (
            <NotesPanel
              selectedAddress={selectedAddress}
              notes={notes}
              noteContent={noteContent}
              notePinned={notePinned}
              onChangeContent={setNoteContent}
              onChangePinned={setNotePinned}
              onCreate={createNote}
              onClose={closeNotes}
            />
          ) : (
            <div className="border rounded p-4 text-sm text-gray-500">
              Sélectionne une adresse (via la liste ou la carte) pour afficher les notes.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
