"use client";

import type { Target } from "../types";

type Props = {
  activeTargets: Target[];
  inactiveTargets: Target[];
  tourIds: number[];
  tourLoading: boolean;
  onAutoTour: () => void;
  onAddToTour: (id: number) => void;
  onRemoveFromTour: (id: number) => void;
  onDone: (id: number) => void;
  onRepasser: (id: number, days: number) => void;
  onIgnore: (id: number) => void;
  onReset: (id: number) => void;
  onOpenNotes: (address: string) => void;
};

export default function TargetList({
  activeTargets,
  inactiveTargets,
  tourIds,
  tourLoading,
  onAutoTour,
  onAddToTour,
  onRemoveFromTour,
  onDone,
  onRepasser,
  onIgnore,
  onReset,
  onOpenNotes,
}: Props) {
  // Defensive: avoid runtime crashes if parent passes undefined during refactors
  const safeTourIds = Array.isArray(tourIds) ? tourIds : [];
  const safeActive = Array.isArray(activeTargets) ? activeTargets : [];
  const safeInactive = Array.isArray(inactiveTargets) ? inactiveTargets : [];

  const tourSet = new Set(safeTourIds);
  const TOUR_MAX = 8;
  const tourFull = tourIds.length >= TOUR_MAX;


  return (
    <section className="space-y-6">
      {/* -------------------- Actifs -------------------- */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xl font-semibold">Targets actifs</h2>
          <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
          Tournée {tourIds.length}/{TOUR_MAX}
          </span>
          <button
            onClick={onAutoTour}
            disabled={tourLoading}
            className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            
          >

            {safeTourIds.length > 0 ? "Clear tournée" : "Tournée automatique"}
            {tourLoading ? "…" : ""}
          </button>
          </div>
        </div>

        {safeActive.length === 0 ? (
          <div className="text-gray-500">Job’s done ✅</div>
        ) : (
          <ul className="space-y-2">
            {safeActive.map((t) => {
              const inTour = tourSet.has(t.id);
              const tourEligible = t.status === "non_traite"; // règle figée

              return (
                <li key={t.id} className="border p-3 rounded">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong>{t.address}</strong>

                        {inTour && (
                          <span className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white">
                            Tour
                          </span>
                        )}
                      </div>

                      <div className="text-sm text-gray-700 mt-1">
                        {t.surface ?? "—"} m² —{" "}
                        <span className="font-mono">{t.status}</span>
                      </div>

                      <div className="text-sm text-gray-500 mt-1">
                        ({t.date ?? ""})
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end">
                      {/* Tour controls: only for eligible (non_traite) */}
                      {tourEligible ? (
                        inTour ? (
                          <button
                            onClick={() => onRemoveFromTour(t.id)}
                            className="px-3 py-1 bg-blue-100 text-blue-900 rounded"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            onClick={() => onAddToTour(t.id)}
                              disabled={tourFull}
                              className={
                                tourFull
                                  ? "px-3 py-1 bg-gray-200 text-gray-500 rounded cursor-not-allowed"
                                  : "px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                              }
                              title={tourFull ? `Limite atteinte (${TOUR_MAX})` : "Ajouter à la tournée"}
                          >
                            Add
                          </button>
                        )
                      ) : null}

                      <button
                        onClick={() => onDone(t.id)}
                        className="px-3 py-1 bg-green-600 text-white rounded"
                      >
                        Done
                      </button>

                      <button
                        onClick={() => onRepasser(t.id, 7)}
                        className="px-3 py-1 bg-amber-600 text-white rounded"
                      >
                        Repasser J+7
                      </button>

                      <button
                        onClick={() => onIgnore(t.id)}
                        className="px-3 py-1 bg-gray-500 text-white rounded"
                      >
                        Ignore
                      </button>

                      <button
                        onClick={() => onOpenNotes(t.address)}
                        className="px-3 py-1 bg-black text-white rounded"
                      >
                        Notes
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* -------------------- Inactifs -------------------- */}
      <details className="border rounded">
        <summary className="cursor-pointer select-none px-4 py-3 font-semibold">
          Inactifs ({safeInactive.length})
        </summary>

        <div className="px-4 pb-4">
          {safeInactive.length === 0 ? (
            <div className="text-gray-500 mt-2">Aucun target inactif.</div>
          ) : (
            <ul className="space-y-2 mt-3">
              {safeInactive.map((t) => (
                <li key={t.id} className="border p-3 rounded">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <strong>{t.address}</strong> — {t.surface ?? "—"} m² —{" "}
                      <span className="font-mono">{t.status}</span>
                      <div className="text-sm text-gray-500 mt-1">
                        ({t.date ?? ""})
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => onReset(t.id)}
                        className="px-3 py-1 bg-blue-600 text-white rounded"
                      >
                        Remettre à faire
                      </button>
                      <button
                        onClick={() => onOpenNotes(t.address)}
                        className="px-3 py-1 bg-black text-white rounded"
                      >
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
