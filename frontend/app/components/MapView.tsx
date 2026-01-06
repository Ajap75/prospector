"use client";

import type { Icon, Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Target } from "../types";
import type { GeoJsonObject } from "geojson";

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

  // ✅ focus persist (list click)
  focusedTargetId?: number | null;

  // ✅ highlight (hover > focus)
  highlightedTargetId?: number | null;

  // ✅ hover pin -> list highlight
  onHoverTarget?: (id: number | null) => void;
};

function isLineString(obj: GeoJsonObject | null): obj is GeoJsonObject {
  return !!obj && (obj as any).type === "LineString" && Array.isArray((obj as any).coordinates);
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

  // marker refs for programmatic popup opening
  const markerRefs = useRef<Record<number, LeafletMarker | null>>({});

  // Pins ordering: tour first, then others (dedup guaranteed), then capped
  const pins = useMemo(() => {
    const tourPins = actionable.filter((t) => tourSet.has(t.id));

    // ✅ exclude tour ids from the rest to guarantee uniqueness
    const otherPins = actionable.filter((t) => !tourSet.has(t.id));

    return [...tourPins, ...otherPins].slice(0, maxPins);
  }, [actionable, tourSet, maxPins]);


  const hasData = pins.length > 0;
  const center: [number, number] = hasData ? [pins[0].latitude, pins[0].longitude] : [48.8566, 2.3522];

  const [map, setMap] = useState<LeafletMap | null>(null);

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

  // Fit bounds to zone
  useEffect(() => {
    let cancelled = false;

    async function fitToZone() {
      if (!map || !zoneGeoJson) return;

      const L = await import("leaflet");
      const layer = L.geoJSON(zoneGeoJson as any);
      const bounds = layer.getBounds();

      if (!cancelled && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
      }
    }

    void fitToZone();

    return () => {
      cancelled = true;
    };
  }, [map, zoneGeoJson]);

  // Focus: center + open popup (persist focus only)
  useEffect(() => {
    if (!map) return;
    if (!focusedTargetId) return;

    const t = pins.find((x) => x.id === focusedTargetId);
    if (!t) return;

    map.setView([t.latitude, t.longitude], Math.max(map.getZoom(), 16), { animate: true });

    const m = markerRefs.current[focusedTargetId];
    if (m) {
      window.setTimeout(() => {
        try {
          m.openPopup();
        } catch {
          // ignore
        }
      }, 120);
    }
  }, [map, focusedTargetId, pins]);

  // Polyline
  const tourLatLngs = useMemo(() => {
    if (!isLineString(tourPolyline)) return null;

    const coords = (tourPolyline as any).coordinates as [number, number][];
    const latlngs: [number, number][] = coords.map(([lng, lat]) => [lat, lng]);
    return latlngs.length >= 2 ? latlngs : null;
  }, [tourPolyline]);

  return (
    <div className="w-full h-[600px] rounded-lg overflow-hidden border relative">
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

      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }} whenCreated={setMap}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" />

        {zoneGeoJson ? (
          <GeoJSON
            data={zoneGeoJson}
            style={{
              weight: 2,
              fillOpacity: 0.06,
            }}
          />
        ) : null}

        {tourLatLngs ? (
          <Polyline
            positions={tourLatLngs}
            pathOptions={{
              weight: 4,
              opacity: 0.9,
            }}
          />
        ) : null}

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
