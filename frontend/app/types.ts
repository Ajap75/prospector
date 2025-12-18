export type TargetStatus = "non_traite" | "done" | "ignore" | "done_repasser"; // done_repasser arrive Bloc 2

export type Target = {
  id: number;
  address: string;
  surface: number | null;
  date: string | null;
  latitude: number;
  longitude: number;
  status: TargetStatus;
  next_action_at: string | null;
};

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
