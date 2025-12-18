"use client";

import type { Target } from "../types";

type Props = {
  activeTargets: Target[];
  inactiveTargets: Target[];
  onDone: (id: number) => void;
  onRepasser: (id: number, days: number) => void;
  onIgnore: (id: number) => void;
  onReset: (id: number) => void;
  onOpenNotes: (address: string) => void;
};

export default function TargetList({
  activeTargets,
  inactiveTargets,
  onDone,
  onRepasser,
  onIgnore,
  onReset,
  onOpenNotes,
}: Props) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-3">Targets actifs</h2>
        {activeTargets.length === 0 ? (
          <div className="text-gray-500">Job’s done ✅</div>
        ) : (
          <ul className="space-y-2">
            {activeTargets.map((t) => (
              <li key={t.id} className="border p-3 rounded">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <strong>{t.address}</strong> — {t.surface ?? "—"} m² —{" "}
                    <span className="font-mono">{t.status}</span>
                    <div className="text-sm text-gray-500 mt-1">({t.date ?? ""})</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => onDone(t.id)} className="px-3 py-1 bg-green-600 text-white rounded">
                      Done
                    </button>
                    <button onClick={() => onRepasser(t.id, 7)} className="px-3 py-1 bg-amber-600 text-white rounded">
                        Repasser J+7
                    </button>

                    <button onClick={() => onIgnore(t.id)} className="px-3 py-1 bg-gray-500 text-white rounded">
                      Ignore
                    </button>
                    <button onClick={() => onOpenNotes(t.address)} className="px-3 py-1 bg-black text-white rounded">
                      Notes
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="border rounded">
        <summary className="cursor-pointer select-none px-4 py-3 font-semibold">
          Inactifs ({inactiveTargets.length})
        </summary>

        <div className="px-4 pb-4">
          {inactiveTargets.length === 0 ? (
            <div className="text-gray-500 mt-2">Aucun target inactif.</div>
          ) : (
            <ul className="space-y-2 mt-3">
              {inactiveTargets.map((t) => (
                <li key={t.id} className="border p-3 rounded">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <strong>{t.address}</strong> — {t.surface ?? "—"} m² —{" "}
                      <span className="font-mono">{t.status}</span>
                      <div className="text-sm text-gray-500 mt-1">({t.date ?? ""})</div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => onReset(t.id)} className="px-3 py-1 bg-blue-600 text-white rounded">
                        Remettre à faire
                      </button>
                      <button onClick={() => onOpenNotes(t.address)} className="px-3 py-1 bg-black text-white rounded">
                        Notes
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
