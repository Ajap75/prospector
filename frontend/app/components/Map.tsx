"use client";

import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";

const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
);

const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
);

const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
  { ssr: false }
);

const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
);

type DpeItem = {
  id: number;
  address: string;
  surface: number;
  date: string;
  latitude: number;
  longitude: number;
  status: string;
};

export default function Map({ dpe }: { dpe: DpeItem[] }) {
  const hasData = dpe && dpe.length > 0;

  const center: [number, number] = hasData
    ? [dpe[0].latitude, dpe[0].longitude]
    : [48.8566, 2.3522]; // Paris par défaut

  // ⚠️ ICI : on ne charge Leaflet que si on est dans le navigateur
  let defaultIcon: any = undefined;
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const L = require("leaflet");

    defaultIcon = L.icon({
      iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });
  }

  return (
    <div className="w-full h-[600px] rounded-lg overflow-hidden border">
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          // ta tuile noir & blanc, garde celle que tu as mise
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        />

        {dpe.map((item) => (
          <Marker
            key={item.id}
            position={[item.latitude, item.longitude]}
            icon={defaultIcon}
          >
            <Popup>
              <strong>{item.address}</strong>
              <br />
              {item.surface} m²
              <br />
              {item.date}
              <br />
              Statut : {item.status}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
