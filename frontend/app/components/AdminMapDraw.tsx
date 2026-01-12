
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

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJsonObject } from "geojson";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

import type { Map as LeafletMap } from "leaflet";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import("react-leaflet").then((m) => m.GeoJSON), { ssr: false });

type Props = {
  apiBase: string;
  adminUserId: number;
  selectedUserId: number | null;
  zoneGeoJsonString: string | null; // ST_AsGeoJSON string from backend
};

export default function AdminMapDraw({ apiBase, adminUserId, selectedUserId, zoneGeoJsonString }: Props) {
  const [map, setMap] = useState<LeafletMap | null>(null);

  // Drawn polygon as GeoJSON (Polygon or MultiPolygon)
  const [draftGeoJson, setDraftGeoJson] = useState<GeoJsonObject | null>(null);

  const [loadingExisting, setLoadingExisting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keep a ref to the current drawn layer group
  const drawnLayerRef = useRef<any>(null);

  const zoneGeoJson = useMemo(() => {
    if (!zoneGeoJsonString) return null;
    try {
      return JSON.parse(zoneGeoJsonString) as GeoJsonObject;
    } catch {
      return null;
    }
  }, [zoneGeoJsonString]);

  const center: [number, number] = [48.8566, 2.3522];

  // ---------------------------------------------------------------------------
  // Setup Leaflet Draw controls once map exists
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function setupDraw() {
      if (!map) return;

      const L = await import("leaflet");
      await import("leaflet-draw");

      // Create feature group to store drawn items
      const drawnItems = new L.FeatureGroup();
      drawnLayerRef.current = drawnItems;
      map.addLayer(drawnItems);

      // Draw control: polygon only (no marker/circle/polyline)
      const drawControl = new (L as any).Control.Draw({
        edit: {
          featureGroup: drawnItems,
          edit: true,
          remove: true,
        },
        draw: {
          polygon: true,
          rectangle: false,
          polyline: false,
          circle: false,
          circlemarker: false,
          marker: false,
        },
      });

      map.addControl(drawControl);

      // When created, keep ONLY ONE polygon (MVP)
      map.on((L as any).Draw.Event.CREATED, (e: any) => {
        if (cancelled) return;
        const layer = e.layer;

        // Clear previous shapes
        drawnItems.clearLayers();
        drawnItems.addLayer(layer);

        const gj = layer.toGeoJSON();
        setDraftGeoJson(gj as GeoJsonObject);
      });

      // When edited
      map.on((L as any).Draw.Event.EDITED, () => {
        if (cancelled) return;
        const layers = drawnItems.toGeoJSON();
        // FeatureCollection -> take first geometry (MVP: single polygon)
        const first = (layers as any)?.features?.[0]?.geometry ?? null;
        setDraftGeoJson(first as GeoJsonObject | null);
      });

      // When deleted
      map.on((L as any).Draw.Event.DELETED, () => {
        if (cancelled) return;
        setDraftGeoJson(null);
      });

      // Fit to zone if exists
      if (zoneGeoJson) {
        const layer = L.geoJSON(zoneGeoJson as any);
        const bounds = layer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
      }
    }

    void setupDraw();
    return () => {
      cancelled = true;
    };
  }, [map, zoneGeoJson]);

  // ---------------------------------------------------------------------------
  // Load existing territory for selected user (and display it)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadExistingTerritory() {
      if (!map) return;
      if (!selectedUserId) {
        setDraftGeoJson(null);
        // clear drawn layer
        const drawn = drawnLayerRef.current;
        if (drawn) drawn.clearLayers();
        return;
      }

      setLoadingExisting(true);
      try {
        const res = await fetch(
          `${apiBase}/admin/users/${selectedUserId}/territory?admin_user_id=${adminUserId}`,
          { cache: "no-store" }
        );
        const data = await res.json();

        if (cancelled) return;

        const item = data?.item ?? null;
        const drawn = drawnLayerRef.current;

        if (drawn) drawn.clearLayers();

        if (!item?.geojson) {
          setDraftGeoJson(null);
          return;
        }

        // item.geojson is a string (ST_AsGeoJSON)
        const gj = JSON.parse(item.geojson) as GeoJsonObject;

        // display on map via Leaflet directly (so Draw can edit it)
        const L = await import("leaflet");
        const layer = L.geoJSON(gj as any);

        // Put first layer into draw group
        // If MultiPolygon, it may create multiple layers; we keep them all
        if (drawn) {
          layer.eachLayer((l: any) => drawn.addLayer(l));
        }

        // Set draft as the geometry itself
        setDraftGeoJson(gj);

        // Fit bounds
        const bounds = layer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    }

    void loadExistingTerritory();
    return () => {
      cancelled = true;
    };
  }, [map, selectedUserId, apiBase, adminUserId]);

  // ---------------------------------------------------------------------------
  // Save territory
  // ---------------------------------------------------------------------------
  const saveTerritory = async () => {
    if (!selectedUserId) {
      alert("Sélectionne un user.");
      return;
    }
    if (!draftGeoJson) {
      alert("Dessine un polygone avant de sauvegarder.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        `${apiBase}/admin/users/${selectedUserId}/territory?admin_user_id=${adminUserId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Microzone",
            geojson: draftGeoJson,
          }),
        }
      );

      if (!res.ok) {
        const msg = await res.text();
        alert(`Erreur save: ${msg}`);
        return;
      }

      alert("Micro-zone sauvegardée ✅");
    } finally {
      setSaving(false);
    }
  };

  const clearTerritory = async () => {
    if (!selectedUserId) return;
    const ok = window.confirm("Supprimer la micro-zone de ce user ?");
    if (!ok) return;

    const res = await fetch(
      `${apiBase}/admin/users/${selectedUserId}/territory?admin_user_id=${adminUserId}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const msg = await res.text();
      alert(`Erreur delete: ${msg}`);
      return;
    }

    setDraftGeoJson(null);
    const drawn = drawnLayerRef.current;
    if (drawn) drawn.clearLayers();

    alert("Micro-zone supprimée ✅");
  };

  return (
    <div className="border rounded overflow-hidden">
      <div className="p-3 border-b flex items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          {selectedUserId ? (
            <>
              User <span className="font-mono">#{selectedUserId}</span>{" "}
              {loadingExisting ? <span className="text-xs">(loading…)</span> : null}
            </>
          ) : (
            "Sélectionne un user à gauche."
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            onClick={saveTerritory}
            disabled={!selectedUserId || saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <button
            className="px-3 py-2 border rounded disabled:opacity-50"
            onClick={clearTerritory}
            disabled={!selectedUserId}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="h-[650px]">
        <MapContainer
          center={center}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          whenCreated={setMap}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          />

          {/* BU Zone overlay */}
          {zoneGeoJson ? (
            <GeoJSON
              data={zoneGeoJson}
              style={{
                weight: 2,
                fillOpacity: 0.06,
              }}
            />
          ) : null}
        </MapContainer>
      </div>

      <div className="p-3 border-t text-xs text-gray-500 space-y-1">
        <div>• Tooling MVP : 1 micro-zone par user (polygon).</div>
        <div>• Dessine, ajuste (edit), puis Save.</div>
      </div>
    </div>
  );
}
