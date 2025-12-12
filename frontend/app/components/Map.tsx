"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import type { Icon } from "leaflet";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), {
  ssr: false,
});
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), {
  ssr: false,
});

type DpeItem = {
  id: number;
  address: string;
  surface: number;
  date: string;
  latitude: number;
  longitude: number;
  status: string;
};

type Props = {
  dpe: DpeItem[];
  onOpenNotes: (address: string) => void;
};

export default function Map({ dpe, onOpenNotes }: Props) {
  const items = Array.isArray(dpe) ? dpe : [];
  const hasData = items.length > 0;

  const center: [number, number] = hasData
    ? [items[0].latitude, items[0].longitude]
    : [48.8566, 2.3522];

  const [icon, setIcon] = useState<Icon | undefined>(undefined);

  // Crée l'icône Leaflet uniquement côté navigateur
  useEffect(() => {
    let cancelled = false;

    async function loadIcon() {
      const L = await import("leaflet");

      const created = L.icon({
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      if (!cancelled) setIcon(created);
    }

    // On ne fait rien côté serveur
    if (typeof window !== "undefined") {
      void loadIcon();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Optionnel: évite de recréer le tableau à chaque render
  const markers = useMemo(() => items, [items]);

  return (
    <div className="w-full h-[600px] rounded-lg overflow-hidden border relative">
      <div className="absolute top-3 left-3 z-[1000] bg-white/90 border rounded px-3 py-2 text-sm">
        {hasData ? (
          <span>
            {items.length} DPE actif{items.length > 1 ? "s" : ""} sur la carte
          </span>
        ) : (
          <span className="text-gray-600">Aucun DPE actif dans cette zone</span>
        )}
      </div>

      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        />

        {markers.map((item) => (
          <Marker
            key={item.id}
            position={[item.latitude, item.longitude]}
            icon={icon}
          >
            <Popup>
              <div className="space-y-1">
                <div>
                  <strong>{item.address}</strong>
                </div>
                <div>{item.surface} m²</div>
                <div className="text-sm text-gray-600">{item.date}</div>
                <div className="text-sm">Statut : {item.status}</div>

                <div className="pt-2">
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenNotes(item.address);
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
