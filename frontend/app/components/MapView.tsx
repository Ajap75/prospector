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

'use client';

import type { GeoJsonObject } from 'geojson';
import type { Icon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { Target } from '../types';

// hooks must be static
import { useMap } from 'react-leaflet';

const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((m) => m.Popup), { ssr: false });
const GeoJSON = dynamic(() => import('react-leaflet').then((m) => m.GeoJSON), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((m) => m.Polyline), { ssr: false });

type Props = {
  targets: Target[];
  onOpenNotes: (addressKey: string) => void;

  onAddToTour: (id: number) => void;
  onRemoveFromTour: (id: number) => void;

  tourIds: number[];
  tourPolyline: GeoJsonObject | null;

  maxPins?: number;

  // BU zone
  zoneGeoJson?: GeoJsonObject | null;
  zoneName?: string;

  // agent micro-zone
  territoryGeoJson?: GeoJsonObject | null;
  territoryName?: string;

  focusedTargetId?: number | null;
  highlightedTargetId?: number | null;

  onHoverTarget?: (id: number | null) => void;
};

function isLineString(obj: GeoJsonObject | null): obj is GeoJsonObject {
  return !!obj && (obj as any).type === 'LineString' && Array.isArray((obj as any).coordinates);
}

/* ───────────────── SAFE HELPERS ───────────────── */

function getComplementRaw(t: Target): string {
  const c1 = (t as any)?.complement_raw;
  if (typeof c1 === 'string' && c1.trim()) return c1.trim();

  const c2 = (t as any)?.address_extra;
  if (typeof c2 === 'string' && c2.trim()) return c2.trim();

  return '';
}

function getEtageRaw(t: Target): number {
  const v = (t as any)?.etage_raw;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function buildNotesKey(t: Target): string {
  const complement = getComplementRaw(t);
  return complement ? `${t.address} — ${complement}` : t.address;
}

function formatTargetDetails(t: Target): string[] {
  const lines: string[] = [];

  const complement = getComplementRaw(t);
  if (complement) lines.push(complement);

  const floor = getEtageRaw(t);
  if (floor > 0) lines.push(`Étage: ${floor}`);

  return lines;
}

/* ───────────────── VIEWPORT CONTROLLER ───────────────── */

function ViewportController({
  zoneGeoJson,
  territoryGeoJson,
  focusedTarget,
}: {
  zoneGeoJson?: GeoJsonObject | null;
  territoryGeoJson?: GeoJsonObject | null;
  focusedTarget: Target | null;
}) {
  const map = useMap();

  // ✅ Fit bounds on the BU zone if present, else micro-zone
  useEffect(() => {
    const geo = zoneGeoJson ?? territoryGeoJson;
    if (!geo) return;

    (async () => {
      const L = await import('leaflet');
      const layer = L.geoJSON(geo as any);
      const bounds = layer.getBounds();
      if (bounds?.isValid()) {
        map.invalidateSize(true);
        map.fitBounds(bounds, { padding: [24, 24] });
      }
    })();
  }, [map, zoneGeoJson, territoryGeoJson]);

  useEffect(() => {
    if (!focusedTarget) return;
    map.setView([focusedTarget.latitude, focusedTarget.longitude], Math.max(map.getZoom(), 16), {
      animate: true,
    });
  }, [map, focusedTarget]);

  return null;
}

/* ───────────────── MAP VIEW ───────────────── */

export default function MapView({
  targets,
  onOpenNotes,
  onAddToTour,
  onRemoveFromTour,
  tourIds,
  tourPolyline,
  maxPins = 60,
  zoneGeoJson,
  zoneName = '',
  territoryGeoJson,
  territoryName = '',
  focusedTargetId = null,
  highlightedTargetId = null,
  onHoverTarget,
}: Props) {
  const actionable = useMemo(
    () => (Array.isArray(targets) ? targets.filter((t) => t.status === 'non_traite') : []),
    [targets],
  );

  const tourSet = useMemo(() => new Set(tourIds ?? []), [tourIds]);

  const pins = useMemo(() => {
    const inTour = actionable.filter((t) => tourSet.has(t.id));
    const rest = actionable.filter((t) => !tourSet.has(t.id));
    return [...inTour, ...rest].slice(0, maxPins);
  }, [actionable, tourSet, maxPins]);

  const focusedTarget = useMemo(
    () => (focusedTargetId ? pins.find((p) => p.id === focusedTargetId) ?? null : null),
    [focusedTargetId, pins],
  );

  const tourLatLngs = useMemo(() => {
    if (!isLineString(tourPolyline)) return null;
    return (tourPolyline as any).coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
  }, [tourPolyline]);

  /* ───────────── ICONS ───────────── */

  const [icons, setIcons] = useState<Record<string, Icon | undefined>>({});

  useEffect(() => {
    (async () => {
      const L = await import('leaflet');

      const base = {
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41] as [number, number],
        iconAnchor: [12, 41] as [number, number],
        popupAnchor: [1, -34] as [number, number],
        shadowSize: [41, 41] as [number, number],
      };

      const focus = {
        ...base,
        iconSize: [34, 56] as [number, number],
        iconAnchor: [17, 56] as [number, number],
        shadowSize: [56, 56] as [number, number],
      };

      setIcons({
        grey: L.icon({
          iconUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png',
          iconRetinaUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
          ...base,
        }),
        blue: L.icon({
          iconUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
          iconRetinaUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
          ...base,
        }),
        greyFocus: L.icon({
          iconUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png',
          iconRetinaUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
          ...focus,
        }),
        blueFocus: L.icon({
          iconUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
          iconRetinaUrl:
            'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
          ...focus,
        }),
      });
    })();
  }, []);

  const fallbackCenter: [number, number] = [48.8566, 2.3522];

  return (
    <div className="relative w-full h-[600px] rounded-lg overflow-hidden border">
      {/* ✅ Overlay labels (BU + micro-zone) */}
      <div className="absolute z-[1000] left-3 top-3 bg-white/90 backdrop-blur border rounded px-3 py-2 text-xs text-gray-800 space-y-1 shadow">
        <div>
          <span className="font-semibold">Zone BU :</span> {zoneName || '—'}
        </div>
        <div>
          <span className="font-semibold">Micro-zone agent :</span> {territoryName || '—'}
        </div>
      </div>

      <MapContainer center={fallbackCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
        <ViewportController
          zoneGeoJson={zoneGeoJson}
          territoryGeoJson={territoryGeoJson}
          focusedTarget={focusedTarget}
        />

        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        />

        {/* BU zone */}
        {zoneGeoJson && <GeoJSON data={zoneGeoJson} style={{ weight: 2, fillOpacity: 0.06 }} />}

        {/* micro-zone overlay */}
        {territoryGeoJson && (
          <GeoJSON
            data={territoryGeoJson}
            style={{
              weight: 2,
              fillOpacity: 0.02,
              dashArray: '6 6',
            }}
          />
        )}

        {tourLatLngs && <Polyline positions={tourLatLngs} pathOptions={{ weight: 4 }} />}

        {pins.map((t) => {
          const inTour = tourSet.has(t.id);
          const highlighted = highlightedTargetId === t.id;

          const icon = highlighted
            ? inTour
              ? icons.blueFocus
              : icons.greyFocus
            : inTour
            ? icons.blue
            : icons.grey;

          const details = formatTargetDetails(t);
          const notesKey = buildNotesKey(t);

          return (
            <Marker
              key={t.id}
              position={[t.latitude, t.longitude]}
              icon={icon}
              eventHandlers={{
                mouseover: () => onHoverTarget?.(t.id),
                mouseout: () => onHoverTarget?.(null),
              }}
            >
              <Popup>
                <div className="space-y-2">
                  <strong>{t.address}</strong>

                  {details.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {details.map((d, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center px-2 py-0.5 rounded bg-gray-200 text-gray-900 text-xs font-semibold"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="text-sm">
                    {t.surface ?? '—'} m² · <span className="font-mono">{t.status}</span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    {inTour ? (
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
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
                        onOpenNotes(notesKey);
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
