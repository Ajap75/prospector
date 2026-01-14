/**
 * ─────────────────────────────────────────────────────────────
 * Project : prospector
 * File    : ProspectionPage.tsx
 * Author  : Antoine Astruc
 * Email   : antoine@maisonastruc.fr
 * Created : 2026-01-08
 * License : MIT
 * ─────────────────────────────────────────────────────────────
 */

'use client';

import type { GeoJsonObject } from 'geojson';
import { useEffect, useMemo, useState } from 'react';

import MapView from '../../app/components/MapView';
import NotesPanel from '../../app/components/NotesPanel';
import TargetList from '../../app/components/TargetList';
import type { Note, Target } from '../../app/types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

// MVP no-auth
const DEV_USER_ID = 11;

const TOUR_MAX = 8;
const TOUR_STORAGE_KEY = (userId: number, zoneId: number | null) =>
  `prospector:tour:u:${userId}:z:${zoneId ?? 'none'}`;

function normalizeTourIds(raw: unknown, allTargets: Target[], max = TOUR_MAX): number[] {
  if (!Array.isArray(raw)) return [];

  const byId = new Map(allTargets.map((t) => [t.id, t]));
  const cleaned: number[] = [];

  for (const x of raw) {
    if (typeof x !== 'number') continue;
    const t = byId.get(x);
    if (!t) continue;
    if (t.status !== 'non_traite') continue;
    if (cleaned.includes(x)) continue;
    cleaned.push(x);
    if (cleaned.length >= max) break;
  }
  return cleaned;
}

export default function ProspectionPage() {
  const [targets, setTargets] = useState<Target[]>([]);

  const [zoneId, setZoneId] = useState<number | null>(null);
  const [zoneName, setZoneName] = useState<string>('');
  const [zoneGeoJson, setZoneGeoJson] = useState<GeoJsonObject | null>(null);

  // ✅ agent identity + BU identity
  const [agentName, setAgentName] = useState<string>('');
  const [agencyName, setAgencyName] = useState<string>('');

  // ✅ micro-zone agent
  const [territoryName, setTerritoryName] = useState<string>('');
  const [territoryGeoJson, setTerritoryGeoJson] = useState<GeoJsonObject | null>(null);

  // ✅ distinguish “job done” vs “no territory”
  const [hasTerritory, setHasTerritory] = useState<boolean | null>(null);

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteContent, setNoteContent] = useState('');
  const [notePinned, setNotePinned] = useState(false);

  const [tourIds, setTourIds] = useState<number[]>([]);
  const [tourLoading, setTourLoading] = useState(false);
  const [tourHydrated, setTourHydrated] = useState(false);

  const [focusedTargetId, setFocusedTargetId] = useState<number | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<number | null>(null);
  const highlightedTargetId = hoveredTargetId ?? focusedTargetId;

  const isRepasserDue = (t: Target) =>
    t.status === 'done_repasser' &&
    !!t.next_action_at &&
    new Date(t.next_action_at).getTime() <= Date.now();

  const activeTargets = useMemo(
    () => targets.filter((t) => t.status === 'non_traite' || isRepasserDue(t)),
    [targets],
  );

  const inactiveTargets = useMemo(
    () =>
      targets.filter((t) => {
        if (t.status === 'done' || t.status === 'ignore') return true;
        if (t.status === 'done_repasser' && !isRepasserDue(t)) return true;
        return false;
      }),
    [targets],
  );

  const actionableTargetsForMap = useMemo(
    () => targets.filter((t) => t.status === 'non_traite'),
    [targets],
  );

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
      coords.push([t.longitude, t.latitude]);
    }
    if (coords.length < 2) return null;

    return { type: 'LineString', coordinates: coords } as unknown as GeoJsonObject;
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
      if (!tNew || tNew.status !== 'non_traite') return prev;

      if (prev.length === 0) return [id];

      const tourTargets: Target[] = prev
        .map((tid) => targets.find((x) => x.id === tid))
        .filter(Boolean) as Target[];

      if (tourTargets.length !== prev.length) {
        return [...prev, id].slice(0, TOUR_MAX);
      }

      let bestIdx = 0;
      let bestDelta = Number.POSITIVE_INFINITY;

      {
        const delta = distance2(tNew, tourTargets[0]);
        bestDelta = delta;
        bestIdx = 0;
      }

      for (let i = 0; i < tourTargets.length - 1; i++) {
        const A = tourTargets[i];
        const B = tourTargets[i + 1];
        const delta = distance2(A, tNew) + distance2(tNew, B) - distance2(A, B);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i + 1;
        }
      }

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

  const startAutoTour = async () => {
    if (tourIds.length > 0) {
      setTourHydrated(true);
      try {
        localStorage.removeItem(TOUR_STORAGE_KEY(DEV_USER_ID, zoneId));
      } catch {}
      setTourIds([]);
      return;
    }

    try {
      setTourLoading(true);

      const res = await fetch(`${API_BASE}/route/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: DEV_USER_ID }),
      });

      if (!res.ok) {
        alert('Impossible de générer une tournée automatique.');
        return;
      }

      const data = await res.json();
      const rawIds: unknown = data.target_ids_ordered ?? [];

      const normalized = normalizeTourIds(rawIds, targets, TOUR_MAX);

      if (normalized.length === 0) {
        alert('Impossible de générer une tournée automatique.');
        return;
      }

      setTourHydrated(true);
      setTourIds(normalized);
    } catch (e) {
      console.error('POST /route/auto failed', e);
      alert('Impossible de générer une tournée automatique.');
    } finally {
      setTourLoading(false);
    }
  };

  const buildGoogleMapsUrl = (ids: number[], allTargets: Target[]): string | null => {
    if (!Array.isArray(ids) || ids.length === 0) return null;

    const byId = new Map(allTargets.map((t) => [t.id, t]));
    const pts: string[] = [];

    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      if (typeof t.latitude !== 'number' || typeof t.longitude !== 'number') continue;
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

    return mids.length > 0 ? `${base}&waypoints=${encodeURIComponent(mids.join('|'))}` : base;
  };

  const googleMapsUrl = useMemo(() => buildGoogleMapsUrl(tourIds, targets), [tourIds, targets]);

  const openTourInGoogleMaps = () => {
    if (!googleMapsUrl) {
      alert('Ajoute au moins 1 point dans la tournée.');
      return;
    }
    window.open(googleMapsUrl, '_blank', 'noopener,noreferrer');
  };

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

  // ✅ Load effective zone + has_territory + agent/BU + micro-zone
  // Backend response is currently in "flat" dev format:
  //   { item, agency_name, user_name, has_territory, territory_name, territory_geojson }
  // but we also support the newer nested format:
  //   { me:{name}, agency:{name}, has_territory, territory:{name, geojson}, item:{...} }
  useEffect(() => {
    let cancelled = false;

    async function loadMyZone() {
      try {
        const res = await fetch(`${API_BASE}/me/zone?user_id=${DEV_USER_ID}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;

        const data = await res.json();
        const item = data?.item ?? null;

        if (cancelled) return;

        // ----- identity (support both shapes)
        const userName = String(data?.user_name ?? data?.me?.name ?? '');
        const buName = String(data?.agency_name ?? data?.agency?.name ?? '');
        setAgentName(userName);
        setAgencyName(buName);

        // ----- territory (support both shapes)
        const terrName = String(data?.territory_name ?? data?.territory?.name ?? '');
        setTerritoryName(terrName);

        const terrGeoStr: unknown =
          data?.territory_geojson ?? data?.territory?.geojson ?? null;

        if (typeof terrGeoStr === 'string' && terrGeoStr.trim()) {
          try {
            setTerritoryGeoJson(JSON.parse(terrGeoStr) as GeoJsonObject);
          } catch {
            setTerritoryGeoJson(null);
          }
        } else {
          setTerritoryGeoJson(null);
        }

        // has_territory
        setHasTerritory(typeof data?.has_territory === 'boolean' ? data.has_territory : null);

        // ----- BU zone
        if (!item) {
          setZoneId(null);
          setZoneName('');
          setZoneGeoJson(null);
          return;
        }

        setZoneId(item.id);
        setZoneName(item.name ?? '');

        if (item.geojson) {
          try {
            const parsed = JSON.parse(item.geojson) as GeoJsonObject;
            setZoneGeoJson(parsed);
          } catch {
            setZoneGeoJson(null);
          }
        } else {
          setZoneGeoJson(null);
        }
      } catch (e) {
        console.error('Fetch /me/zone failed', e);
      }
    }

    void loadMyZone();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTargets() {
      try {
        setFocusedTargetId(null);
        setHoveredTargetId(null);
        setTourIds([]);
        setTargets([]);
        setTourHydrated(false);

        const res = await fetch(`${API_BASE}/dpe?user_id=${DEV_USER_ID}`, { cache: 'no-store' });
        if (!res.ok) return;

        const data = await res.json();
        const raw = Array.isArray(data?.items) ? data.items : [];

        const items: Target[] = raw.map((t: any) => ({
          id: Number(t.id),
          address: String(t.address ?? ''),
          address_extra: t.address_extra == null ? null : String(t.address_extra),

          surface: t.surface == null ? null : Number(t.surface),
          date: t.date == null ? null : String(t.date),
          latitude: Number(t.latitude),
          longitude: Number(t.longitude),
          status: t.status,
          next_action_at: t.next_action_at == null ? null : String(t.next_action_at),

          // keep raw fields if present
          ...(t.etage_raw !== undefined ? { etage_raw: t.etage_raw } : {}),
          ...(t.complement_raw !== undefined ? { complement_raw: t.complement_raw } : {}),
        }));

        if (!cancelled) setTargets(items);
      } catch (e) {
        console.error('Fetch /dpe failed', e);
      }
    }

    if (zoneId !== null) void loadTargets();
    return () => {
      cancelled = true;
    };
  }, [zoneId]);

  useEffect(() => {
    if (zoneId === null) return;
    if (targets.length === 0) return;
    if (tourHydrated) return;

    try {
      const raw = localStorage.getItem(TOUR_STORAGE_KEY(DEV_USER_ID, zoneId));
      if (raw) {
        const parsed = JSON.parse(raw);
        const restored = normalizeTourIds(parsed, targets, TOUR_MAX);
        if (restored.length > 0) setTourIds(restored);
      }
    } catch {
    } finally {
      setTourHydrated(true);
    }
  }, [zoneId, targets, tourHydrated]);

  useEffect(() => {
    if (zoneId === null) return;
    if (!tourHydrated) return;

    try {
      localStorage.setItem(TOUR_STORAGE_KEY(DEV_USER_ID, zoneId), JSON.stringify(tourIds));
    } catch {}
  }, [zoneId, tourIds, tourHydrated]);

  const updateStatus = async (
    id: number,
    status: Target['status'],
    nextActionAt: string | null = null,
  ) => {
    const body: Record<string, unknown> = { status };
    if (status === 'done_repasser') body.next_action_at = nextActionAt;

    const res = await fetch(`${API_BASE}/dpe/${id}/status?user_id=${DEV_USER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      alert('Erreur backend : statut non mis à jour');
      return;
    }

    setTargets((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status, next_action_at: status === 'done_repasser' ? nextActionAt : null }
          : t,
      ),
    );

    if (status !== 'non_traite') {
      removeFromTour(id);
      if (focusedTargetId === id) setFocusedTargetId(null);
      if (hoveredTargetId === id) setHoveredTargetId(null);
    }
  };

  const repasserInDays = async (id: number, days: number) => {
    const next = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await updateStatus(id, 'done_repasser', next);
  };

  const loadNotes = async (address: string) => {
    const res = await fetch(
      `${API_BASE}/notes?address=${encodeURIComponent(address)}&user_id=${DEV_USER_ID}`,
      { cache: 'no-store' },
    );
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
    setNoteContent('');
    setNotePinned(false);
  };

  const createNote = async () => {
    if (!selectedAddress) return;

    const content = noteContent.trim();
    if (!content) return;

    const res = await fetch(`${API_BASE}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: selectedAddress,
        content,
        pinned: notePinned,
        user_id: DEV_USER_ID,
      }),
    });

    if (!res.ok) {
      alert('Erreur : note non enregistrée');
      return;
    }

    setNoteContent('');
    setNotePinned(false);
    await loadNotes(selectedAddress);
  };

  const emptyState =
    zoneId !== null && targets.length === 0
      ? hasTerritory === false
        ? {
            kind: 'no_territory' as const,
            message: 'Aucune micro-zone attribuée — contacte l’admin.',
          }
        : { kind: 'job_done' as const, message: 'Job’s done ✅' }
      : null;

  return (
    <main className="p-10 space-y-10">
      {/* ✅ RESTORED HEADER */}
      <header className="space-y-2">
        <h1 className="text-6xl font-semibold tracking-tight text-gray-800">PROSPECTOR</h1>

        <div className="text-lg text-gray-500 flex flex-wrap gap-x-10 gap-y-3">
          <div>
            Agent : <span className="font-semibold text-gray-800">{agentName || `#${DEV_USER_ID}`}</span>
          </div>
          <div>
            BU : <span className="font-semibold text-gray-800">{agencyName || '—'}</span>
          </div>
          <div>
            Zone BU : <span className="font-semibold text-gray-800">{zoneName || '—'}</span>
          </div>
          <div>
            Micro-zone agent : <span className="font-semibold text-gray-800">{territoryName || '—'}</span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
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
            onDone={(id) => updateStatus(id, 'done')}
            onRepasser={(id, days) => repasserInDays(id, days)}
            onIgnore={(id) => updateStatus(id, 'ignore')}
            onReset={(id) => updateStatus(id, 'non_traite')}
            onOpenNotes={openAddressNotes}
            onFocusTarget={(id) => setFocusedTargetId(id)}
            focusedTargetId={highlightedTargetId}
            onHoverTarget={setHoveredTargetId}
            emptyState={emptyState}
          />
        </div>

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
              zoneName={zoneName}
              territoryGeoJson={territoryGeoJson}
              territoryName={territoryName}
              focusedTargetId={focusedTargetId}
              highlightedTargetId={highlightedTargetId}
              onHoverTarget={setHoveredTargetId}
            />
          </div>

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
