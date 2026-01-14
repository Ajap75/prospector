import type { GeoJsonObject } from "geojson";


export type TargetStatus = "non_traite" | "done" | "ignore" | "done_repasser"; // done_repasser arrive Bloc 2

export type Target = {
  id: number;
  address: string;
  address_extra?: string | null; // RAW
  etage_raw?: number | null;     // RAW (0 = bruit)
  surface: number | null;
  date: string | null;
  latitude: number;
  longitude: number;
  status: TargetStatus;
  next_action_at: string | null;
};
T


export type Zone = {
  id: number;
  name: string;
};

export type Note = {
  id: number;
  dpe_id: number | null;
  address: string;
  content: string;
  tags: string | null;
  pinned: boolean;
  created_at: string;
};

export type RouteAutoResponse = {
  zone_id: number;
  target_ids_ordered: number[];
  polyline: GeoJsonObject;
};

