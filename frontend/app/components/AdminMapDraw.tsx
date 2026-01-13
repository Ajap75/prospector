/**
 * ─────────────────────────────────────────────────────────────
 * Project : prospector
 * File    : AdminMapDraw.tsx
 * Author  : Antoine Astruc
 * Email   : antoine@maisonastruc.fr
 * Created : 2026-01-12
 * License : MIT
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJsonObject } from "geojson";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import("react-leaflet").then((m) => m.GeoJSON), { ssr: false });

type AdminUser = {
  id: number;
  name: string;
};

type TerritoryItem = {
  id: number;
  user_id: number;
  agency_id: number;
  name: string;
  geojson: string; // feature/geometry JSON string
};

type Props = {
  apiBase: string;
  adminUserId: number;
  agencyId: number;

  users: AdminUser[];

  selectedUserId: number | null;
  hoveredUserId: number | null;

  onSelectUserId: (id: number | null) => void;
  onHoverUserId: (id: number | null) => void;

  zoneGeoJsonString: string | null; // BU zone geojson (string)
};

function safeParseGeoJson(str: string | null): GeoJsonObject | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as GeoJsonObject;
  } catch {
    return null;
  }
}

function colorForUser(userId: number): string {
  // deterministic palette (enough for 10-15 users easily)
  const palette = [
    "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#0ea5e9",
    "#f97316", "#059669", "#db2777", "#ca8a04", "#334155",
    "#22c55e", "#ef4444", "#8b5cf6", "#06b6d4", "#f59e0b",
  ];
  return palette[Math.abs(userId) % palette.length];
}

export default function AdminMapDraw({
  apiBase,
  adminUserId,
  agencyId,
  users,
  selectedUserId,
  hoveredUserId,
  onSelectUserId,
  onHoverUserId,
  zoneGeoJsonString,
}: Props) {
  const zoneGeoJson = useMemo(() => safeParseGeoJson(zoneGeoJsonString), [zoneGeoJsonString]);

  const userNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users ?? []) m.set(u.id, u.name);
    return m;
  }, [users]);

  const [territories, setTerritories] = useState<TerritoryItem[]>([]);
  const [drawReady, setDrawReady] = useState(false);

  // Leaflet refs
  const mapRef = useRef<any>(null);
  const drawnGroupRef = useRef<any>(null);
  const drawControlRef = useRef<any>(null);

  // ---------------------------------------------------------------------------
  // Load all territories for BU
  // ---------------------------------------------------------------------------
  const loadAllTerritories = async () => {
    if (!Number.isFinite(agencyId)) return;

    try {
      const res = await fetch(
        `${apiBase}/admin/territories?admin_user_id=${adminUserId}&agency_id=${agencyId}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const txt = await res.text();
        console.error("GET /admin/territories failed", txt);
        return;
      }
      const data = await res.json();
      setTerritories(data.items ?? []);
    } catch (e) {
      console.error("GET /admin/territories failed", e);
    }
  };

  useEffect(() => {
    void loadAllTerritories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  // ---------------------------------------------------------------------------
  // Init draw control once (client only)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function initDraw() {
      if (typeof window === "undefined") return;
      if (!mapRef.current) return;

      const L = await import("leaflet");
      await import("leaflet-draw");

      if (cancelled) return;

      // FeatureGroup where the admin draws the selected user's zone
      const drawnItems = new L.FeatureGroup();
      drawnGroupRef.current = drawnItems;
      mapRef.current.addLayer(drawnItems);

      const drawControl = new (L.Control as any).Draw({
        position: "topright",
        draw: {
          polygon: true,
          polyline: false,
          rectangle: false,
          circle: false,
          circlemarker: false,
          marker: false,
        },
        edit: {
          featureGroup: drawnItems,
          remove: true,
        },
      });

      drawControlRef.current = drawControl;
      mapRef.current.addControl(drawControl);

      // When a polygon is created, keep only the last one (MVP)
      mapRef.current.on((L as any).Draw.Event.CREATED, (e: any) => {
        const layer = e.layer;
        drawnItems.clearLayers();
        drawnItems.addLayer(layer);
      });

      setDrawReady(true);
    }

    void initDraw();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fit map to BU zone
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function fitToZone() {
      if (!mapRef.current) return;
      if (!zoneGeoJson) return;

      const L = await import("leaflet");
      const layer = L.geoJSON(zoneGeoJson as any);
      const bounds = layer.getBounds();

      if (!cancelled && bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [24, 24] });
      }
    }

    void fitToZone();
    return () => {
      cancelled = true;
    };
  }, [zoneGeoJson]);

  // ---------------------------------------------------------------------------
  // Helpers: compute a map center fallback
  // ---------------------------------------------------------------------------
  const center: [number, number] = [48.8566, 2.3522];

  // ---------------------------------------------------------------------------
  // Save / Delete territory for selected user (optional: depends on your backend endpoints)
  // ---------------------------------------------------------------------------
  const saveTerritory = async () => {
    if (!selectedUserId) {
      alert("Sélectionne un user.");
      return;
    }
    if (!drawnGroupRef.current) return;

    const layers = drawnGroupRef.current.getLayers?.() ?? [];
    if (layers.length === 0) {
      alert("Dessine une micro-zone avant de sauvegarder.");
      return;
    }

    const layer = layers[0];
    const geojson = layer.toGeoJSON();

    try {
      const res = await fetch(
        `${apiBase}/admin/users/${selectedUserId}/territory?admin_user_id=${adminUserId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `Microzone user ${selectedUserId}`,
            geojson,
          }),
        }
      );

      if (!res.ok) {
        const txt = await res.text();
        alert(`Erreur save: ${txt}`);
        return;
      }

      await loadAllTerritories();
      alert("Micro-zone sauvegardée ✅");
    } catch (e) {
      console.error("saveTerritory failed", e);
      alert("Erreur save: Failed to fetch");
    }
  };

  const deleteTerritory = async () => {
    if (!selectedUserId) {
      alert("Sélectionne un user.");
      return;
    }

    try {
      const res = await fetch(
        `${apiBase}/admin/users/${selectedUserId}/territory?admin_user_id=${adminUserId}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const txt = await res.text();
        alert(`Erreur delete: ${txt}`);
        return;
      }

      if (drawnGroupRef.current) drawnGroupRef.current.clearLayers();
      await loadAllTerritories();
      alert("Micro-zone supprimée ✅");
    } catch (e) {
      console.error("deleteTerritory failed", e);
      alert("Erreur delete: Failed to fetch");
    }
  };

  // ---------------------------------------------------------------------------
  // Render territories GeoJSON layers with events
  // ---------------------------------------------------------------------------
  const territoryLayers = useMemo(() => {
    return territories
      .map((t) => {
        const gj = safeParseGeoJson(t.geojson);
        if (!gj) return null;
        return { ...t, parsed: gj };
      })
      .filter(Boolean) as Array<TerritoryItem & { parsed: GeoJsonObject }>;
  }, [territories]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={saveTerritory}
          disabled={!drawReady || !selectedUserId}
          title={!selectedUserId ? "Sélectionne un user d’abord" : "Sauvegarder la microzone dessinée"}
        >
          Save micro-zone
        </button>

        <button
          className="px-3 py-2 border rounded disabled:opacity-50"
          onClick={deleteTerritory}
          disabled={!selectedUserId}
          title={!selectedUserId ? "Sélectionne un user d’abord" : "Supprimer la microzone du user"}
        >
          Delete micro-zone
        </button>

        <button className="px-3 py-2 border rounded" onClick={loadAllTerritories}>
          Refresh micro-zones
        </button>

        <span className="text-sm text-gray-500">
          BU {agencyId} · micro-zones: {territories.length}
        </span>
      </div>

      <div className="w-full h-[650px] rounded-lg overflow-hidden border relative">
        <MapContainer
          center={center}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          whenCreated={(m) => {
            mapRef.current = m;
          }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          />

          {/* BU zone in background */}
          {zoneGeoJson ? (
            <GeoJSON
              data={zoneGeoJson}
              style={{
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.04,
              }}
            />
          ) : null}

          {/* All microzones */}
          {territoryLayers.map((t) => {
            const userId = t.user_id;
            const baseColor = colorForUser(userId);

            const isHovered = hoveredUserId === userId;
            const isSelected = selectedUserId === userId;

            const weight = isSelected ? 5 : isHovered ? 4 : 2;
            const fillOpacity = isSelected ? 0.22 : isHovered ? 0.18 : 0.10;

            return (
              <GeoJSON
                key={t.id}
                data={t.parsed}
                style={{
                  color: baseColor,
                  weight,
                  opacity: 0.95,
                  fillOpacity,
                }}
                eventHandlers={{
                  mouseover: () => onHoverUserId(userId),
                  mouseout: () => onHoverUserId(null),
                  click: () => onSelectUserId(userId),
                }}
              />
            );
          })}
        </MapContainer>

        {/* Small legend */}
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 border rounded px-3 py-2 text-xs space-y-1">
          <div className="font-semibold">Legend</div>
          <div>Hover une zone ↔ highlight user</div>
          <div>Click une zone ↔ select user</div>
          {selectedUserId ? (
            <div className="text-gray-700">
              Selected:{" "}
              <span className="font-mono">
                {userNameById.get(selectedUserId) ?? `#${selectedUserId}`}
              </span>
            </div>
          ) : (
            <div className="text-gray-400">Selected: —</div>
          )}
        </div>
      </div>
    </div>
  );
}
