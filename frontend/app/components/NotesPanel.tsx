/**
 * ─────────────────────────────────────────────────────────────
 * Project : prospector
 * File    : NotesPanel.tsx
 * Author  : Antoine Astruc
 * Email   : antoine@maisonastruc.com
 * Created : 2026-01-08
 * License : MIT
 * ─────────────────────────────────────────────────────────────
 */


"use client";

import type { Note } from "../types";

type Props = {
  selectedAddress: string;
  notes: Note[];
  noteContent: string;
  notePinned: boolean;
  onChangeContent: (v: string) => void;
  onChangePinned: (v: boolean) => void;
  onCreate: () => void;
  onClose: () => void;
};

export default function NotesPanel({
  selectedAddress,
  notes,
  noteContent,
  notePinned,
  onChangeContent,
  onChangePinned,
  onCreate,
  onClose,
}: Props) {
  const pinnedNotes = notes.filter((n) => n.pinned);
  const regularNotes = notes.filter((n) => !n.pinned);

  return (
    <div className="mt-10 border rounded p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xl font-semibold">
          Notes immeuble — <span className="font-mono">{selectedAddress}</span>
        </h3>

        <button className="px-3 py-1 border rounded" onClick={onClose}>
          Fermer
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <textarea
          className="border rounded p-2 w-full"
          placeholder="Écrire une note immeuble (gardienne, code, refus, etc.)"
          value={noteContent}
          onChange={(e) => onChangeContent(e.target.value)}
          rows={3}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notePinned}
            onChange={(e) => onChangePinned(e.target.checked)}
          />
          📌 Pinned (info importante / permanente)
        </label>

        <button onClick={onCreate} className="px-3 py-2 bg-blue-600 text-white rounded w-fit">
          Ajouter la note
        </button>
      </div>

      <div className="mt-6">
        {notes.length === 0 ? (
          <div className="text-gray-500">Aucune note pour cette adresse.</div>
        ) : (
          <>
            {pinnedNotes.length > 0 && (
              <div className="mb-4 border rounded p-3">
                <div className="font-semibold mb-2">📌 Infos immeuble (pinned)</div>
                <ul className="space-y-2">
                  {pinnedNotes.map((n) => (
                    <li key={n.id} className="border rounded p-2">
                      <div className="text-sm text-gray-500">
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap">{n.content}</div>
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
                    {n.tags ? <span className="font-mono">{n.tags}</span> : null}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{n.content}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
