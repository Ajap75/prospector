/**
 * ─────────────────────────────────────────────────────────────
 * Project : prospector
 * File    : MapView.tsx
 * Author  : Antoine Astruc
 * Email   : antoine@maisonastruc.com
 * Created : 2026-01-08
 * License : MIT
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import type { Icon, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJsonObject } from "geojson";
import type { Target } from "../types";

// ✅ IMPORTANT: hooks must be statically imported
import { useMap } from "react-leaflet";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });
const GeoJSON = dynamic(() => import("react-leaflet").then((m) => m.GeoJSON), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });

type Props = {
  targets: Target[]; // actionnables (non_traite)
  onOpenNotes: (address: string) => void;

  onAddToTour: (id: number) => void;
  onRemoveFromTour: (id: number) => void;

  tourIds: number[];
  tourPolyline: GeoJsonObject | null;

  maxPins?: number;
  zoneGeoJson?: GeoJsonObject | null;

  focusedTargetId?: number | null;
  highlightedTargetId?: number | null;

  onHoverTarget?: (id: number | null) => void;
};

function isLineString(obj: GeoJsonObject | null): obj is GeoJsonObject {
  return !!obj && (obj as any).type === "LineString" && Array.isArray((obj as any).coordinates);
}

/**
 * ✅ Viewport controller lives INSIDE MapContainer tree, so useMap works.
 * It:
 * - fits to BU zone
 * - centers on focused target
 */
function ViewportController({
  zoneGeoJson,
  focusedTarget,
  dbgSet,
}: {
  zoneGeoJson?: GeoJsonObject | null;
  focusedTarget: Target | null;
  dbgSet: (s: string | ((prev: string) => string)) => void;
}) {
  const map = useMap();

  // Fit bounds to zone (once zone is known / changes)
  useEffect(() => {
    let cancelled = false;

    async function fit() {
      if (!zoneGeoJson) {
        dbgSet("debug:zoneGeoJson=null");
        return;
      }

      dbgSet(`debug:map=OK zone.type=${(zoneGeoJson as any)?.type ?? "?"}`);

      const L = await import("leaflet");
      const layer = L.geoJSON(zoneGeoJson as any);
      const bounds = layer.getBounds();

      if (!bounds || !bounds.isValid()) {
        dbgSet("debug:bounds=INVALID");
        return;
      }

      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      dbgSet(
        `debug:bounds OK sw=${sw.lat.toFixed(5)},${sw.lng.toFixed(5)} ne=${ne.lat.toFixed(5)},${ne.lng.toFixed(5)}`
      );

      window.setTimeout(() => {
        if (cancelled) return;
        try {
          map.invalidateSize(true);
          map.fitBounds(bounds, { padding: [24, 24] });
          dbgSet((prev) => `${prev} | fitBounds done (zoom=${map.getZoom()})`);
        } catch {
          dbgSet("debug:fitBounds threw");
        }
      }, 0);
    }

    void fit();
    return () => {
      cancelled = true;
    };
  }, [map, zoneGeoJson, dbgSet]);

  // Focus handling
  useEffect(() => {
    if (!focusedTarget) return;
    map.setView([focusedTarget.latitude, focusedTarget.longitude], Math.max(map.getZoom(), 16), { animate: true });
  }, [map, focusedTarget]);

  return null;
}

export default function MapView({
  targets,
  onOpenNotes,
  onAddToTour,
  onRemoveFromTour,
  tourIds,
  tourPolyline,
  maxPins = 60,
  zoneGeoJson,
  focusedTargetId = null,
  highlightedTargetId = null,
  onHoverTarget,
}: Props) {
  const items = Array.isArray(targets) ? targets : [];
  const actionable = useMemo(() => items.filter((t) => t.status === "non_traite"), [items]);
  const tourSet = useMemo(() => new Set(tourIds ?? []), [tourIds]);

  const markerRefs = useRef<Record<number, LeafletMarker | null>>({});

  const pins = useMemo(() => {
    const tourPins = actionable.filter((t) => tourSet.has(t.id));
    const otherPins = actionable.filter((t) => !tourSet.has(t.id));
    return [...tourPins, ...otherPins].slice(0, maxPins);
  }, [actionable, tourSet, maxPins]);

  const hasData = pins.length > 0;

  // fallback center: will be immediately overridden by fitBounds when zone exists
  const fallbackCenter: [number, number] = [48.8566, 2.3522];

  // debug overlay
  const [dbg, setDbg] = useState<string>("debug:init");

  // Icons
  const [iconGrey, setIconGrey] = useState<Icon | undefined>(undefined);
  const [iconBlue, setIconBlue] = useState<Icon | undefined>(undefined);
  const [iconGreyFocus, setIconGreyFocus] = useState<Icon | undefined>(undefined);
  const [iconBlueFocus, setIconBlueFocus] = useState<Icon | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function loadIcons() {
      const L = await import("leaflet");

      const common = {
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41] as [number, number],
        iconAnchor: [12, 41] as [number, number],
        popupAnchor: [1, -34] as [number, number],
        shadowSize: [41, 41] as [number, number],
      };

      const commonFocus = {
        ...common,
        iconSize: [34, 56] as [number, number],
        iconAnchor: [17, 56] as [number, number],
        shadowSize: [56, 56] as [number, number],
      };

      const grey = L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png",
        iconRetinaUrl:
          "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png",
        ...common,
      });

      const blue = L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
        iconRetinaUrl:
          "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
        ...common,
      });

      const greyFocus = L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png",
        iconRetinaUrl:
          "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png",
        ...commonFocus,
      });

      const blueFocus = L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
        iconRetinaUrl:
          "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
        ...commonFocus,
      });

      if (!cancelled) {
        setIconGrey(grey);
        setIconBlue(blue);
        setIconGreyFocus(greyFocus);
        setIconBlueFocus(blueFocus);
      }
    }

    if (typeof window !== "undefined") void loadIcons();
    return () => {
      cancelled = true;
    };
  }, []);

  const focusedTarget = useMemo(() => {
    if (!focusedTargetId) return null;
    return pins.find((p) => p.id === focusedTargetId) ?? null;
  }, [focusedTargetId, pins]);

  // Polyline
  const tourLatLngs = useMemo(() => {
    if (!isLineString(tourPolyline)) return null;
    const coords = (tourPolyline as any).coordinates as [number, number][];
    const latlngs: [number, number][] = coords.map(([lng, lat]) => [lat, lng]);
    return latlngs.length >= 2 ? latlngs : null;
  }, [tourPolyline]);

  return (
    <div className="w-full h-[600px] rounded-lg overflow-hidden border relative">
      {/* Debug overlay */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 border rounded px-3 py-2 text-xs max-w-[520px]">
        <div className="font-mono">{dbg}</div>
        <div className="text-gray-600 mt-1">
          pins={pins.length} zone={zoneGeoJson ? "yes" : "no"}
        </div>
      </div>

      <div className="absolute top-3 left-3 z-[1000] bg-white/90 border rounded px-3 py-2 text-sm space-y-1">
        {hasData ? (
          <>
            <div>
              {pins.length} target{pins.length > 1 ? "s" : ""} affiché{pins.length > 1 ? "s" : ""} (max {maxPins})
            </div>
            <div className="text-xs text-gray-600">
              Tournée: {tourIds?.length ?? 0} point{(tourIds?.length ?? 0) > 1 ? "s" : ""}
            </div>
          </>
        ) : (
          <span className="text-gray-600">Aucun target actionnable dans cette zone</span>
        )}
      </div>

      <MapContainer center={fallbackCenter} zoom={13} style={{ height: "100%", width: "100%" }}>
        {/* ✅ viewport controlled here */}
        <ViewportController zoneGeoJson={zoneGeoJson} focusedTarget={focusedTarget} dbgSet={setDbg} />

        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        />

        {zoneGeoJson ? (
          <GeoJSON
            data={zoneGeoJson}
            style={{
              weight: 2,
              fillOpacity: 0.06,
            }}
          />
        ) : null}

        {tourLatLngs ? <Polyline positions={tourLatLngs} pathOptions={{ weight: 4, opacity: 0.9 }} /> : null}

        {pins.map((t) => {
          const inTour = tourSet.has(t.id);
          const isHighlighted = highlightedTargetId === t.id;

          let icon = inTour ? iconBlue : iconGrey;
          if (isHighlighted) icon = inTour ? iconBlueFocus : iconGreyFocus;

          return (
            <Marker
              key={t.id}
              position={[t.latitude, t.longitude]}
              icon={icon}
              ref={(ref) => {
                markerRefs.current[t.id] = ref ?? null;
              }}
              eventHandlers={{
                mouseover: () => onHoverTarget?.(t.id),
                mouseout: () => onHoverTarget?.(null),
              }}
            >
              <Popup>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <strong>{t.address}</strong>
                    {inTour ? <span className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white">Tour</span> : null}
                  </div>

                  <div className="text-sm">
                    {t.surface ?? "—"} m² · <span className="font-mono">{t.status}</span>
                  </div>
                  <div className="text-xs text-gray-600">{t.date ?? ""}</div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {inTour ? (
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onRemoveFromTour(t.id);
                        }}
                        className="px-3 py-1 bg-blue-100 text-blue-900 rounded"
                      >
                        Retirer
                      </button>
                    ) : (
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onAddToTour(t.id);
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded"
                      >
                        Ajouter
                      </button>
                    )}

                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenNotes(t.address);
                      }}
                      className="px-3 py-1 bg-black text-white rounded"
                    >
                      Notes
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
