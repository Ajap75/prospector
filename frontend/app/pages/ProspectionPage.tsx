"use client";

import { useEffect, useMemo, useState } from "react";
import type { GeoJsonObject } from "geojson";

import type { Note, Target, Zone } from "../types";
import TargetList from "../components/TargetList";
import MapView from "../components/MapView";
import NotesPanel from "../components/NotesPanel";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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

  // --- Status rules (MVP) ---
  const isRepasserDue = (t: Target) =>
    t.status === "done_repasser" &&
    !!t.next_action_at &&
    new Date(t.next_action_at).getTime() <= Date.now();

  // ✅ Actifs = non_traite + done_repasser (dû)
  const activeTargets = useMemo(
    () => targets.filter((t) => t.status === "non_traite" || isRepasserDue(t)),
    [targets] // isRepasserDue stable enough; we keep deps minimal
  );

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

  // ✅ Carte = orientation : seulement non_traite (actionnables)
  const actionableTargetsForMap = useMemo(
    () => targets.filter((t) => t.status === "non_traite"),
    [targets]
  );

  // ---------------------------------------------------------------------------
  // 1) Load zones once (source de vérité initiale)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadZones() {
      try {
        const res = await fetch(`${API_BASE}/zones`, { cache: "no-store" });
        if (!res.ok) {
          console.warn("GET /zones failed:", res.status);
          return;
        }

        const data = await res.json();
        const items: Zone[] = data.items ?? [];

        if (cancelled) return;

        setZones(items);

        // ✅ init zone selection
        if (items.length > 0) {
          setZoneId((prev) => (prev ? prev : items[0].id));
        }
      } catch (e) {
        console.error("Fetch /zones failed", e);
      }
    }

    void loadZones();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // 2) Load targets when zone changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadTargets() {
      try {
        setTargets([]);

        const res = await fetch(`${API_BASE}/dpe?zone_id=${zoneId}`, { cache: "no-store" });
        if (!res.ok) {
          console.warn("GET /dpe failed:", res.status);
          return;
        }

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
  // 3) Load zone GeoJSON overlay when zone changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadZoneGeo() {
      try {
        setZoneGeoJson(null);

        const res = await fetch(`${API_BASE}/zones/${zoneId}`, { cache: "no-store" });
        if (!res.ok) {
          console.warn("GET /zones/{id} failed:", res.status);
          return;
        }

        const data = await res.json();
        const geojsonStr: string | undefined = data?.item?.geojson;

        if (!geojsonStr) {
          console.warn("Missing item.geojson in response:", data);
          return;
        }

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
  // Write path: Status update (single path)
  // ---------------------------------------------------------------------------
  const updateStatus = async (
    id: number,
    status: Target["status"],
    nextActionAt: string | null = null
  ) => {
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

    // optimistic update after backend OK
    setTargets((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
              next_action_at: status === "done_repasser" ? nextActionAt : null,
            }
          : t
      )
    );
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
        <div className="space-y-8">
          <TargetList
            activeTargets={activeTargets}
            inactiveTargets={inactiveTargets}
            onDone={(id) => updateStatus(id, "done")}
            onRepasser={(id, days) => repasserInDays(id, days)}
            onIgnore={(id) => updateStatus(id, "ignore")}
            onReset={(id) => updateStatus(id, "non_traite")}
            onOpenNotes={openAddressNotes}
          />

          {selectedAddress && (
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
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Carte (orientation)</h2>
          <MapView
            targets={actionableTargetsForMap}
            onOpenNotes={openAddressNotes}
            maxPins={60}
            zoneGeoJson={zoneGeoJson}
          />
        </div>
      </section>
    </main>
  );
}
