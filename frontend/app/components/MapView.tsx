"use client";

import type { Icon } from "leaflet";
import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Target } from "../types";
import type { GeoJsonObject } from "geojson";


const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });
const GeoJSON = dynamic(() => import("react-leaflet").then((m) => m.GeoJSON), { ssr: false });

type Props = {
  targets: Target[]; // actionnables
  onOpenNotes: (address: string) => void;
  maxPins?: number;
  zoneGeoJson?: GeoJsonObject | null;
};

export default function MapView({
  targets,
  onOpenNotes,
  maxPins = 60,
  zoneGeoJson,
}: Props) {
  const items = Array.isArray(targets) ? targets : [];
  const actionable = useMemo(() => items.filter((t) => t.status === "non_traite"), [items]);

  const pins = useMemo(() => actionable.slice(0, maxPins), [actionable, maxPins]);

  const hasData = pins.length > 0;
  const center: [number, number] = hasData ? [pins[0].latitude, pins[0].longitude] : [48.8566, 2.3522];

  const [icon, setIcon] = useState<Icon | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function loadIcon() {
      const L = await import("leaflet");
      const created = L.icon({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      if (!cancelled) setIcon(created);
    }

    if (typeof window !== "undefined") void loadIcon();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full h-[600px] rounded-lg overflow-hidden border relative">
      <div className="absolute top-3 left-3 z-[1000] bg-white/90 border rounded px-3 py-2 text-sm">
        {hasData ? (
          <span>
            {pins.length} target{pins.length > 1 ? "s" : ""} affiché{pins.length > 1 ? "s" : ""} (max {maxPins})
          </span>
        ) : (
          <span className="text-gray-600">Aucun target actionnable dans cette zone</span>
        )}
      </div>

      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        />

        {/* ✅ Zone overlay (lecture seule) */}
        {zoneGeoJson ? (
          <GeoJSON
            data={zoneGeoJson}
            style={{
              weight: 2,
              fillOpacity: 0.06,
            }}
          />
        ) : null}

        {pins.map((t) => (
          <Marker key={t.id} position={[t.latitude, t.longitude]} icon={icon}>
            <Popup>
              <div className="space-y-1">
                <div>
                  <strong>{t.address}</strong>
                </div>
                <div>{t.surface ?? "—"} m²</div>
                <div className="text-sm text-gray-600">{t.date ?? ""}</div>
                <div className="text-sm">Statut : {t.status}</div>

                <div className="pt-2">
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
        ))}
      </MapContainer>
    </div>
  );
}
