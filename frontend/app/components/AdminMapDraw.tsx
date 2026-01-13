
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

type Mode = "territory" | "bu_zone";

type Props = {
  apiBase: string;
  adminUserId: number;
  agencyId: number;

  // micro-zones overlay
  users: AdminUser[];
  selectedUserId: number | null;
  hoveredUserId: number | null;
  onSelectUserId: (id: number) => void;
  onHoverUserId: (id: number | null) => void;

  // BU zone display (and in bu_zone mode: editable)
  zoneGeoJsonString: string | null;

  mode: Mode;
};

function ringToLatLngs(ring: any[]): [number, number][] {
  // GeoJSON ring: [ [lng,lat], ... ]
  // Leaflet: [ [lat,lng], ... ]
  return (Array.isArray(ring) ? ring : [])
    .filter((pt) => Array.isArray(pt) && pt.length >= 2 && pt[0] != null && pt[1] != null)
    .map((pt) => [Number(pt[1]), Number(pt[0])] as [number, number]);
}

function addGeometryAsEditablePolygons(leaflet: any, fg: any, geometry: any) {
  if (!geometry) return;

  const t = geometry.type;
  const coords = geometry.coordinates;

  if (t === "Polygon") {
    // coords: [ outerRing, hole1, hole2, ... ]
    const latlngs = (coords || []).map(ringToLatLngs).filter((r: any[]) => r.length >= 3);
    if (latlngs.length > 0) fg.addLayer(leaflet.polygon(latlngs));
    return;
  }

  if (t === "MultiPolygon") {
    // coords: [ polygon1Coords, polygon2Coords, ... ]
    for (const poly of coords || []) {
      const latlngs = (poly || []).map(ringToLatLngs).filter((r: any[]) => r.length >= 3);
      if (latlngs.length > 0) fg.addLayer(leaflet.polygon(latlngs));
    }
  }
}

function extractGeometry(obj: any): any | null {
  if (!obj) return null;

  // GeoJSON Geometry
  if (obj.type === "Polygon" || obj.type === "MultiPolygon") return obj;

  // Feature
  if (obj.type === "Feature") return obj.geometry ?? null;

  // FeatureCollection
  if (obj.type === "FeatureCollection") {
    const f0 = obj.features?.find((f: any) => f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon");
    return f0?.geometry ?? null;
  }

  // Fallback
  if (obj.geometry && (obj.geometry.type === "Polygon" || obj.geometry.type === "MultiPolygon")) return obj.geometry;

  return null;
}

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
  if (!fc) return null;

  const features = Array.isArray(fc.features) ? fc.features : [];
  if (features.length === 0) return null;

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

function normalizeLeafletFeatureGroupRef(ref: any): any {
  // react-leaflet ref varies by versions:
  // - sometimes it is the Leaflet FG itself (has toGeoJSON)
  // - sometimes it wraps: { leafletElement: L.FeatureGroup }
  // - sometimes it’s { instance: L.FeatureGroup }
  if (!ref) return null;
  if (typeof ref.toGeoJSON === "function") return ref;
  if (ref.leafletElement && typeof ref.leafletElement.toGeoJSON === "function") return ref.leafletElement;
  if (ref.instance && typeof ref.instance.toGeoJSON === "function") return ref.instance;
  if (ref._leaflet_id && typeof ref.getLayers === "function") return ref; // heuristic
  return ref;
}

async function fetchJsonOrText(url: string, init: RequestInit) {
  // Helper: always returns { ok, status, text, json? }
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
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
    mode,
  } = props;

  const zoneGeoJson = useMemo(() => safeParseGeoJsonString(zoneGeoJsonString), [zoneGeoJsonString]);

  const [map, setMap] = useState<LeafletMap | null>(null);
  const [territories, setTerritories] = useState<TerritoryItem[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>("");

  // ✅ edit rules
  const canEdit = mode === "bu_zone" ? true : selectedUserId !== null;

  // ✅ Leaflet FeatureGroup instance is stored here
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
    const url = `${apiBase}/admin/territories?admin_user_id=${adminUserId}&agency_id=${encodeURIComponent(String(agencyId))}`;

    try {
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
    } catch (e) {
      console.error("NETWORK/CORS error on GET /admin/territories", e, { url });
      setStatusMsg("❌ Failed to fetch /admin/territories (CORS/Network).");
    }
  };

  useEffect(() => {
    void loadAllTerritories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  // Fit to BU zone (overlay)
  useEffect(() => {
    if (!map || !zoneGeoJson) return;

    (async () => {
      const leaflet = await import("leaflet");
      const layer = leaflet.geoJSON(zoneGeoJson as any);
      const bounds = layer.getBounds();
      if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [24, 24] });
    })();
  }, [map, zoneGeoJson]);

  // ✅ Load editable geometry into featureGroup depending on mode
  // IMPORTANT: do NOT inject leaflet.geoJSON layers into FG for editing,
  // because leaflet-draw can crash on MultiPolygon/geoJSON-produced layers.
  useEffect(() => {
    const fgRaw = featureGroupRef.current;
    const fg = normalizeLeafletFeatureGroupRef(fgRaw);
    if (!fg) return;

    const clear = () => {
      try {
        fg.clearLayers?.();
      } catch {}
    };

    const fitToFG = () => {
      try {
        const bounds = fg.getBounds?.();
        if (bounds?.isValid?.() && map) map.fitBounds(bounds, { padding: [36, 36] });
      } catch {}
    };

    if (mode === "bu_zone") {
      clear();

      const geom = extractGeometry(zoneGeoJson);
      if (!geom) {
        setStatusMsg("Zone BU absente : dessine un polygone puis “Save”.");
        return;
      }

      (async () => {
        const leaflet = await import("leaflet");
        addGeometryAsEditablePolygons(leaflet, fg, geom);
        fitToFG();
        setStatusMsg("Zone BU chargée. Tu peux éditer puis “Save”.");
      })();

      return;
    }

    // mode === "territory"
    if (!canEdit) {
      setStatusMsg("Sélectionne un agent pour activer la toolbar.");
      clear();
      return;
    }

    const uid = selectedUserId!;
    const t = territories.find((x) => x.user_id === uid) ?? null;

    clear();

    if (!t) {
      setStatusMsg("Aucune micro-zone existante. Dessine puis “Save”.");
      return;
    }

    (async () => {
      const leaflet = await import("leaflet");
      const geom = extractGeometry(t.geojson);
      if (!geom) {
        setStatusMsg("Micro-zone invalide. Redessine puis “Save”.");
        return;
      }
      addGeometryAsEditablePolygons(leaflet, fg, geom);
      fitToFG();
      setStatusMsg("Micro-zone chargée. Tu peux éditer puis “Save”.");
    })();
  }, [mode, canEdit, selectedUserId, territories, map, zoneGeoJson]);

  const save = async () => {
    const fgRaw = featureGroupRef.current;
    const fg = normalizeLeafletFeatureGroupRef(fgRaw);
    if (!fg) return alert("FeatureGroup non prêt.");

    const fc = fg.toGeoJSON?.();
    const geometry = firstGeometryFromFeatureGroupToGeoJSON(fc);

    if (!geometry) return alert("Dessine un polygone avant de sauvegarder.");
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
      return alert("Seuls Polygon / MultiPolygon sont supportés.");
    }

    // Build URL + payload depending on mode
    const url =
      mode === "bu_zone"
        ? `${apiBase}/admin/zone?agency_id=${encodeURIComponent(String(agencyId))}&admin_user_id=${encodeURIComponent(String(adminUserId))}`
        : `${apiBase}/admin/users/${encodeURIComponent(String(selectedUserId ?? ""))}/territory?admin_user_id=${encodeURIComponent(String(adminUserId))}`;

    if (mode !== "bu_zone" && !selectedUserId) return alert("Sélectionne un agent.");

    const payload =
      mode === "bu_zone"
        ? { name: `Zone BU ${agencyId}`, geojson: geometry }
        : { name: `Microzone ${selectedUserId}`, geojson: geometry };

    setStatusMsg("⏳ Sauvegarde en cours…");

    try {
      const result = await fetchJsonOrText(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!result.ok) {
        console.error("SAVE failed", { url, payload, status: result.status, text: result.text, json: result.json });
        setStatusMsg(`❌ Erreur save (${result.status}).`);
        return alert(`Erreur save (${result.status})\n${result.text || "(no body)"}`);
      }

      if (mode === "bu_zone") {
        setStatusMsg("✅ Zone BU sauvegardée.");
        return;
      }

      setStatusMsg("✅ Micro-zone sauvegardée.");
      await loadAllTerritories();
    } catch (e) {
      // This is the exact "Failed to fetch" case (CORS/Network/Backend down)
      console.error("NETWORK/CORS error on SAVE", e, { url, payload });
      setStatusMsg("❌ Failed to fetch (CORS/Network). Regarde DevTools > Network (OPTIONS).");
      alert("Failed to fetch (CORS/Network). Regarde DevTools > Network (OPTIONS).");
    }
  };

  const remove = async () => {
    const ok = confirm(mode === "bu_zone" ? "Supprimer la Zone BU ? (plus aucun target visible)" : "Supprimer la micro-zone de cet agent ?");
    if (!ok) return;

    if (mode !== "bu_zone" && !selectedUserId) return alert("Sélectionne un agent.");

    const url =
      mode === "bu_zone"
        ? `${apiBase}/admin/zone?agency_id=${encodeURIComponent(String(agencyId))}&admin_user_id=${encodeURIComponent(String(adminUserId))}`
        : `${apiBase}/admin/users/${encodeURIComponent(String(selectedUserId))}/territory?admin_user_id=${encodeURIComponent(String(adminUserId))}`;

    setStatusMsg("⏳ Suppression…");

    try {
      const result = await fetchJsonOrText(url, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });

      if (!result.ok) {
        console.error("DELETE failed", { url, status: result.status, text: result.text, json: result.json });
        setStatusMsg(`❌ Erreur delete (${result.status}).`);
        return alert(`Erreur delete (${result.status})\n${result.text || "(no body)"}`);
      }

      try {
        const fg = normalizeLeafletFeatureGroupRef(featureGroupRef.current);
        fg?.clearLayers?.();
      } catch {}

      if (mode === "bu_zone") {
        setStatusMsg("🗑️ Zone BU supprimée.");
        return;
      }

      setStatusMsg("🗑️ Micro-zone supprimée.");
      await loadAllTerritories();
    } catch (e) {
      console.error("NETWORK/CORS error on DELETE", e, { url });
      setStatusMsg("❌ Failed to fetch (CORS/Network) sur delete.");
      alert("Failed to fetch (CORS/Network) sur delete. Regarde DevTools > Network (OPTIONS).");
    }
  };

  const clearDraft = () => {
    try {
      const fg = normalizeLeafletFeatureGroupRef(featureGroupRef.current);
      fg?.clearLayers?.();
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

  const hint =
    mode === "bu_zone"
      ? "Mode Zone BU : dessine/édite le polygone du garde-fou BU."
      : "Sélectionne un agent à gauche pour activer la toolbar.";

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-gray-600">{statusMsg || "—"}</div>

        <div className="flex items-center gap-2">
          <button
            className={canEdit ? "px-3 py-2 bg-blue-600 text-white rounded" : "px-3 py-2 bg-gray-200 text-gray-500 rounded cursor-not-allowed"}
            onClick={save}
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
            className={canEdit ? "px-3 py-2 bg-red-600 text-white rounded" : "px-3 py-2 bg-gray-200 text-gray-500 rounded cursor-not-allowed"}
            onClick={remove}
            disabled={!canEdit}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="w-full h-[650px] rounded-lg overflow-hidden border relative">
        <div className="absolute top-3 left-3 z-[1000] bg-white/90 border rounded px-3 py-2 text-sm">{hint}</div>

        <MapContainer center={defaultCenter} zoom={13} style={{ height: "100%", width: "100%" }} whenCreated={setMap}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" />

          {/* BU zone overlay (always visible if present) */}
          {zoneGeoJson ? <GeoJSON data={zoneGeoJson} style={{ weight: 2, opacity: 0.85, fillOpacity: 0.05 } as any} /> : null}

          {/* Micro-zones overlay */}
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

          {/* ✅ Editable layer inside react-leaflet tree */}
          <FeatureGroup
            ref={(ref: any) => {
              featureGroupRef.current = normalizeLeafletFeatureGroupRef(ref);
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
