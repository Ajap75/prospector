"use client";

import { useEffect, useMemo, useState } from "react";
import Map from "./components/Map";

type DpeItem = {
  id: number;
  address: string;
  surface: number;
  date: string;
  latitude: number;
  longitude: number;
  status: string;
};

type ZoneItem = {
  id: number;
  name: string;
};

type NoteItem = {
  id: number;
  dpe_id: number | null;
  address: string;
  content: string;
  tags: string | null;
  pinned: boolean;
  created_at: string;
};

export default function Home() {
  const [dpe, setDpe] = useState<DpeItem[]>([]);
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [zoneId, setZoneId] = useState<number>(1);

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [noteContent, setNoteContent] = useState("");
  const [notePinned, setNotePinned] = useState(false);

  // Source de vérité: ce que la MAP doit afficher (backlog "actif")
  const dpeForMap = useMemo(
    () => dpe.filter((item) => item.status === "non_traite"),
    [dpe]
  );

  const pinnedNotes = useMemo(() => notes.filter((n) => n.pinned), [notes]);
  const regularNotes = useMemo(() => notes.filter((n) => !n.pinned), [notes]);

  // 1) Load zones once
  useEffect(() => {
    fetch("http://localhost:8000/zones", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setZones(data.items ?? []));
  }, []);

  // 2) Load DPE when zone changes
  useEffect(() => {
    setDpe([]);
    fetch(`http://localhost:8000/dpe?zone_id=${zoneId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setDpe(data.items ?? []));
  }, [zoneId]);

  const updateStatus = async (id: number, status: string) => {
    const res = await fetch(`http://localhost:8000/dpe/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      alert("Erreur backend : statut non mis à jour");
      return;
    }

    // UI update (optimistic after backend OK)
    setDpe((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
  };

  const loadNotes = async (address: string) => {
    const res = await fetch(
      `http://localhost:8000/notes?address=${encodeURIComponent(address)}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    setNotes(data.items ?? []);
  };

  const openNotes = async (address: string) => {
    setSelectedAddress(address);
    await loadNotes(address);
  };

  const closeNotes = () => {
    setSelectedAddress(null);
    setNotes([]);
    setNoteContent("");
    setNotePinned(false);
  };

  const createNote = async () => {
    if (!selectedAddress) return;
    const content = noteContent.trim();
    if (!content) return;

    const res = await fetch("http://localhost:8000/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: selectedAddress,
        content,
        pinned: notePinned,
      }),
    });

    if (!res.ok) {
      alert("Erreur : note non enregistrée");
      return;
    }

    setNoteContent("");
    setNotePinned(false);
    await loadNotes(selectedAddress);
  };

  return (
    <main className="p-10">
      <h1 className="text-4xl font-bold mb-6">HELLO PROSPECTOR</h1>

      {/* Zone selector */}
      <div className="mb-6 flex items-center gap-3">
        <label className="font-medium">Zone :</label>
        <select
          className="border rounded px-3 py-2"
          value={zoneId}
          onChange={(e) => setZoneId(Number(e.target.value))}
        >
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </div>

      {/* Backlog */}
      <h2 className="text-2xl font-semibold mb-4">Backlog (tous les DPE)</h2>

      <ul className="space-y-2">
        {dpe.map((item) => (
          <li key={item.id} className="border p-3 rounded">
            <div className="flex items-start justify-between gap-4">
              <div>
                <strong>{item.address}</strong> — {item.surface} m² —{" "}
                <span className="font-mono">{item.status}</span>
                <div className="text-sm text-gray-500 mt-1">({item.date})</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateStatus(item.id, "done")}
                  className="px-3 py-1 bg-green-600 text-white rounded"
                >
                  Done
                </button>

                <button
                  onClick={() => updateStatus(item.id, "ignore")}
                  className="px-3 py-1 bg-gray-500 text-white rounded"
                >
                  Ignore
                </button>

                {(item.status === "done" || item.status === "ignore") && (
                  <button
                    onClick={() => updateStatus(item.id, "non_traite")}
                    className="px-3 py-1 bg-blue-600 text-white rounded"
                  >
                    Remettre à faire
                  </button>
                )}

                <button
                  onClick={() => openNotes(item.address)}
                  className="px-3 py-1 bg-black text-white rounded"
                >
                  Notes
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Notes panel */}
      {selectedAddress && (
        <div className="mt-10 border rounded p-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-xl font-semibold">
              Notes immeuble —{" "}
              <span className="font-mono">{selectedAddress}</span>
            </h3>

            <button className="px-3 py-1 border rounded" onClick={closeNotes}>
              Fermer
            </button>
          </div>

          {/* Create note */}
          <div className="mt-4 flex flex-col gap-2">
            <textarea
              className="border rounded p-2 w-full"
              placeholder="Écrire une note immeuble (gardienne, code, refus, etc.)"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              rows={3}
            />

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notePinned}
                onChange={(e) => setNotePinned(e.target.checked)}
              />
              📌 Pinned (info importante / permanente)
            </label>

            <button
              onClick={createNote}
              className="px-3 py-2 bg-blue-600 text-white rounded w-fit"
            >
              Ajouter la note
            </button>
          </div>

          {/* Notes display */}
          <div className="mt-6">
            {notes.length === 0 ? (
              <div className="text-gray-500">
                Aucune note pour cette adresse.
              </div>
            ) : (
              <>
                {pinnedNotes.length > 0 && (
                  <div className="mb-4 border rounded p-3">
                    <div className="font-semibold mb-2">
                      📌 Infos immeuble (pinned)
                    </div>
                    <ul className="space-y-2">
                      {pinnedNotes.map((n) => (
                        <li key={n.id} className="border rounded p-2">
                          <div className="text-sm text-gray-500">
                            {new Date(n.created_at).toLocaleString()}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">
                            {n.content}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="font-semibold mb-2">Historique</div>
                <ul className="space-y-2">
                  {regularNotes.map((n) => (
                    <li key={n.id} className="border rounded p-2">
                      <div className="text-sm text-gray-500 flex items-center justify-between">
                        <span>{new Date(n.created_at).toLocaleString()}</span>
                        {n.tags ? (
                          <span className="font-mono">{n.tags}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap">{n.content}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {/* Map */}
      <h2 className="text-2xl font-semibold mt-10 mb-4">
        Carte (DPE actifs uniquement)
      </h2>
      <Map
  key={zoneId}
  dpe={dpeForMap}
  onOpenNotes={(address) => openNotes(address)}
/>

    </main>
  );
}
