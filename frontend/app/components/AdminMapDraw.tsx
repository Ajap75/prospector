"use client";

import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJsonObject, Geometry } from "geojson";
import type { Map as LeafletMap } from "leaflet";

// ✅ react-leaflet components (dynamic for SSR safety)
const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import("react-leaflet").then((m) => m.GeoJSON), { ssr: false });
const FeatureGroup = dynamic(() => import("react-leaflet").then((m) => m.FeatureGroup), { ssr: false });

// ✅ react-leaflet-draw (dynamic too)
const EditControl = dynamic(() => import("react-leaflet-draw").then((m) => m.EditControl), { ssr: false });

type AdminUser = {
  id: number;
  agency_id: number;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  min_surface_m2?: number | null;
  max_surface_m2?: number | null;
  has_territory?: boolean;
};

type TerritoryItem = {
  id: number;
  user_id: number;
  agency_id: number;
  name: string;
  geojson: GeoJsonObject;
};

type Props = {
  apiBase: string;
  adminUserId: number;
  agencyId: number;
  users: AdminUser[];
  selectedUserId: number | null;
  hoveredUserId: number | null;
  onSelectUserId: (id: number) => void;
  onHoverUserId: (id: number | null) => void;
  zoneGeoJsonString: string | null;
};

function safeParseGeoJsonString(str: string | null): GeoJsonObject | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as GeoJsonObject;
  } catch {
    return null;
  }
}

function normalizeTerritoryGeoJson(x: any): GeoJsonObject | null {
  if (!x) return null;
  if (typeof x === "string") {
    try {
      return JSON.parse(x) as GeoJsonObject;
    } catch {
      return null;
    }
  }
  return x as GeoJsonObject;
}

function firstGeometryFromFeatureGroupToGeoJSON(fc: any): Geometry | null {
  // react-leaflet FeatureGroup -> L.FeatureGroup -> toGeoJSON()
  // can be FeatureCollection or GeometryCollection-ish
  if (!fc) return null;

  const features = Array.isArray(fc.features) ? fc.features : [];
  if (features.length === 0) return null;

  // take first polygon/multipolygon in features
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === "Polygon" || g.type === "MultiPolygon") return g as Geometry;
  }
  return null;
}

const PALETTE = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#7c3aed",
  "#ea580c",
  "#0d9488",
  "#9333ea",
  "#4b5563",
  "#ca8a04",
  "#0891b2",
];

function colorForUserId(userId: number): string {
  return PALETTE[Math.abs(userId) % PALETTE.length];
}

export default function AdminMapDraw(props: Props) {
  const {
    apiBase,
    adminUserId,
    agencyId,
    users,
    selectedUserId,
    hoveredUserId,
    onSelectUserId,
    onHoverUserId,
    zoneGeoJsonString,
  } = props;

  const zoneGeoJson = useMemo(() => safeParseGeoJsonString(zoneGeoJsonString), [zoneGeoJsonString]);

  const [map, setMap] = useState<LeafletMap | null>(null);
  const [territories, setTerritories] = useState<TerritoryItem[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>("");

  const canEdit = selectedUserId !== null;

  // ✅ Leaflet FeatureGroup instance is stored here (set in onMounted)
  const featureGroupRef = useRef<any>(null);

  // user lookup
  const userById = useMemo(() => {
    const m = new Map<number, AdminUser>();
    (users ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const labelForUserId = (uid: number) => {
    const u = userById.get(uid);
    const name = (u?.name ?? "").trim();
    return name ? `${name} (#${uid})` : `User #${uid}`;
  };

  const loadAllTerritories = async () => {
    const url =
      `${apiBase}/admin/territories?admin_user_id=${adminUserId}` +
      `&agency_id=${encodeURIComponent(String(agencyId))}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error("GET /admin/territories failed", await res.text());
      return;
    }

    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    setTerritories(
      items
        .map((it: any) => {
          const gj = normalizeTerritoryGeoJson(it.geojson);
          if (!gj) return null;
          return {
            id: Number(it.id),
            user_id: Number(it.user_id),
            agency_id: Number(it.agency_id),
            name: String(it.name ?? ""),
            geojson: gj,
          } as TerritoryItem;
        })
        .filter(Boolean) as TerritoryItem[]
    );
  };

  useEffect(() => {
    void loadAllTerritories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  // Fit to BU zone
  useEffect(() => {
    if (!map || !zoneGeoJson) return;

    (async () => {
      const leaflet = await import("leaflet");
      const layer = leaflet.geoJSON(zoneGeoJson as any);
      const bounds = layer.getBounds();
      if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [24, 24] });
    })();
  }, [map, zoneGeoJson]);

  // Load selected user's territory into editable featureGroup
  useEffect(() => {
    const fg = featureGroupRef.current;
    if (!fg) return;

    if (!canEdit) {
      setStatusMsg("Sélectionne un agent pour activer la toolbar.");
      try {
        fg.clearLayers?.();
      } catch {}
      return;
    }

    const uid = selectedUserId!;
    const t = territories.find((x) => x.user_id === uid) ?? null;

    try {
      fg.clearLayers?.();
    } catch {}

    if (!t) {
      setStatusMsg("Aucune micro-zone existante. Dessine puis “Save”.");
      return;
    }

    (async () => {
      const leaflet = await import("leaflet");
      const gjLayer = leaflet.geoJSON(t.geojson as any);

      gjLayer.eachLayer((layer: any) => {
        fg.addLayer?.(layer);
      });

      const bounds = gjLayer.getBounds?.();
      if (bounds?.isValid?.() && map) map.fitBounds(bounds, { padding: [36, 36] });

      setStatusMsg("Micro-zone chargée. Tu peux éditer puis “Save”.");
    })();
  }, [canEdit, selectedUserId, territories, map]);

  const saveTerritory = async () => {
    if (!selectedUserId) return alert("Sélectionne un agent.");

    const fg = featureGroupRef.current;
    if (!fg) return alert("FeatureGroup non prêt.");

    const fc = fg.toGeoJSON?.();
    const geometry = firstGeometryFromFeatureGroupToGeoJSON(fc);

    if (!geometry) return alert("Dessine un polygone avant de sauvegarder.");
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
      return alert("Seuls Polygon / MultiPolygon sont supportés.");
    }

    const payload = { name: `Microzone ${selectedUserId}`, geojson: geometry };

    const res = await fetch(`${apiBase}/admin/users/${selectedUserId}/territory?admin_user_id=${adminUserId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return alert(`Erreur save: ${await res.text()}`);

    setStatusMsg("✅ Micro-zone sauvegardée.");
    await loadAllTerritories();
  };

  const deleteTerritory = async () => {
    if (!selectedUserId) return alert("Sélectionne un agent.");
    if (!confirm("Supprimer la micro-zone de cet agent ?")) return;

    const res = await fetch(`${apiBase}/admin/users/${selectedUserId}/territory?admin_user_id=${adminUserId}`, {
      method: "DELETE",
    });

    if (!res.ok) return alert(`Erreur delete: ${await res.text()}`);

    try {
      featureGroupRef.current?.clearLayers?.();
    } catch {}

    setStatusMsg("🗑️ Micro-zone supprimée.");
    await loadAllTerritories();
  };

  const clearDraft = () => {
    try {
      featureGroupRef.current?.clearLayers?.();
    } catch {}
    setStatusMsg("Draft effacé. Dessine un nouveau polygone.");
  };

  // Territories style + hover
  const effectiveHighlightedUserId = hoveredUserId ?? selectedUserId ?? null;

  const territoryStyle = (uid: number) => {
    const base = colorForUserId(uid);
    const highlighted = effectiveHighlightedUserId === uid;
    return {
      color: base,
      weight: highlighted ? 4 : 2,
      opacity: highlighted ? 0.95 : 0.75,
      fillColor: base,
      fillOpacity: highlighted ? 0.22 : 0.12,
    };
  };

  const defaultCenter: [number, number] = [48.8566, 2.3522];

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-gray-600">{statusMsg || "—"}</div>

        <div className="flex items-center gap-2">
          <button
            className={
              canEdit ? "px-3 py-2 bg-blue-600 text-white rounded" : "px-3 py-2 bg-gray-200 text-gray-500 rounded cursor-not-allowed"
            }
            onClick={saveTerritory}
            disabled={!canEdit}
          >
            Save
          </button>

          <button
            className={canEdit ? "px-3 py-2 border rounded hover:bg-gray-50" : "px-3 py-2 border rounded text-gray-400 cursor-not-allowed"}
            onClick={clearDraft}
            disabled={!canEdit}
          >
            Clear
          </button>

          <button
            className={
              canEdit ? "px-3 py-2 bg-red-600 text-white rounded" : "px-3 py-2 bg-gray-200 text-gray-500 rounded cursor-not-allowed"
            }
            onClick={deleteTerritory}
            disabled={!canEdit}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="w-full h-[650px] rounded-lg overflow-hidden border relative">
        {!canEdit ? (
          <div className="absolute top-3 left-3 z-[1000] bg-white/90 border rounded px-3 py-2 text-sm">
            Sélectionne un agent à gauche pour activer la toolbar.
          </div>
        ) : null}

        <MapContainer center={defaultCenter} zoom={13} style={{ height: "100%", width: "100%" }} whenCreated={setMap}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" />

          {zoneGeoJson ? <GeoJSON data={zoneGeoJson} style={{ weight: 2, opacity: 0.85, fillOpacity: 0.05 } as any} /> : null}

          {territories.map((t) => (
            <GeoJSON
              key={t.id}
              data={t.geojson}
              style={territoryStyle(t.user_id) as any}
              eventHandlers={{
                mouseover: () => onHoverUserId(t.user_id),
                mouseout: () => onHoverUserId(null),
                click: () => onSelectUserId(t.user_id),
              }}
              onEachFeature={(_feature: any, layer: any) => {
                layer.bindTooltip(labelForUserId(t.user_id), { sticky: true, direction: "top" });
              }}
            />
          ))}

          {/* ✅ Editable layer lives INSIDE react-leaflet tree */}
          <FeatureGroup
            ref={(ref: any) => {
              // react-leaflet gives a wrapper; leaflet instance is `.leafletElement` in old versions,
              // but in newer versions it’s usually ref.current itself being the L.FeatureGroup.
              // We normalize by taking `ref` as-is.
              featureGroupRef.current = ref;
            }}
          >
            {canEdit ? (
              <EditControl
                position="topright"
                onCreated={() => setStatusMsg("Polygone prêt. Clique “Save”.")}
                onEdited={() => setStatusMsg("Polygone modifié. Clique “Save”.")}
                onDeleted={() => setStatusMsg("Polygone supprimé. Dessine puis “Save”.")}
                draw={{
                  polygon: {
                    allowIntersection: false,
                    showArea: true,
                    shapeOptions: { weight: 2, opacity: 0.9, fillOpacity: 0.12 },
                  },
                  polyline: false,
                  rectangle: false,
                  circle: false,
                  circlemarker: false,
                  marker: false,
                }}
              />
            ) : null}
          </FeatureGroup>
        </MapContainer>
      </div>
    </div>
  );
}
