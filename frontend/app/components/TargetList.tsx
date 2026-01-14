/**
 * ─────────────────────────────────────────────────────────────
 * Project : prospector
 * File    : TargetList.tsx
 * Author  : Antoine Astruc
 * Email   : antoine@maisonastruc.com
 * Created : 2026-01-08
 * License : MIT
 * ─────────────────────────────────────────────────────────────
 */

'use client';

import { useMemo, useState } from 'react';
import type { Target } from '../types';

type EmptyState = { kind: 'no_territory'; message: string } | { kind: 'job_done'; message: string };

type Props = {
  activeTargets: Target[];
  inactiveTargets: Target[];

  tourIds: number[];
  tourLoading: boolean;

  onAutoTour: () => void;
  onAddToTour: (id: number) => void;
  onRemoveFromTour: (id: number) => void;

  googleMapsUrl: string | null;
  onOpenGoogleMaps: () => void;

  onDone: (id: number) => void;
  onRepasser: (id: number, days: number) => void;
  onIgnore: (id: number) => void;
  onReset: (id: number) => void;

  // ⚠️ note key peut être adresse OU adresse + complément (safe)
  onOpenNotes: (addressKey: string) => void;

  onFocusTarget: (id: number) => void;
  focusedTargetId?: number | null;

  onHoverTarget?: (id: number | null) => void;

  emptyState?: EmptyState | null;
};

function getComplementRaw(t: Target): string {
  // Compat: ancien champ address_extra + nouveau complement_raw
  const c1 = (t as any)?.complement_raw;
  if (typeof c1 === 'string' && c1.trim()) return c1.trim();

  const c2 = (t as any)?.address_extra;
  if (typeof c2 === 'string' && c2.trim()) return c2.trim();

  return '';
}

function getEtageRaw(t: Target): number {
  const v = (t as any)?.etage_raw;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

function buildNotesKey(t: Target): string {
  // SAFE: évite de mélanger les notes “même adresse mais portes/étages différents”
  const complement = getComplementRaw(t);
  return complement ? `${t.address} — ${complement}` : t.address;
}

function formatTargetDetails(t: Target): string[] {
  // ✅ DECISION: display RAW only
  // - si complement_raw existe → afficher en premier
  // - si etage_raw > 0 → afficher "Étage : X"
  // - si etage_raw = 0 → ne rien afficher
  const lines: string[] = [];

  const complement = getComplementRaw(t);
  if (complement) lines.push(complement);

  const floor = getEtageRaw(t);
  if (floor > 0) lines.push(`Étage : ${floor}`);

  return lines;
}

export default function TargetList({
  activeTargets,
  inactiveTargets,
  tourIds,
  tourLoading,
  onAutoTour,
  onAddToTour,
  onRemoveFromTour,
  googleMapsUrl,
  onOpenGoogleMaps,
  onDone,
  onRepasser,
  onIgnore,
  onReset,
  onOpenNotes,
  onFocusTarget,
  focusedTargetId = null,
  onHoverTarget,
  emptyState = null,
}: Props) {
  const safeTourIds = Array.isArray(tourIds) ? tourIds : [];
  const safeActive = Array.isArray(activeTargets) ? activeTargets : [];
  const safeInactive = Array.isArray(inactiveTargets) ? inactiveTargets : [];

  const TOUR_MAX = 8;
  const tourFull = safeTourIds.length >= TOUR_MAX;

  const tourSet = new Set(safeTourIds);
  const tourIndex = new Map<number, number>(safeTourIds.map((id, i) => [id, i + 1]));

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const matches = (t: Target) => {
    if (!q) return true;

    const addr = (t.address ?? '').toLowerCase();
    const complement = getComplementRaw(t).toLowerCase();

    if (addr.includes(q)) return true;
    if (complement.includes(q)) return true;
    return String(t.id).includes(q);
  };

  const filteredActive = useMemo(() => safeActive.filter(matches), [safeActive, q]);
  const filteredInactive = useMemo(() => safeInactive.filter(matches), [safeInactive, q]);
  const isFiltering = q.length > 0;

  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);

  const canUseGoogle = !!googleMapsUrl && safeTourIds.length >= 2;

  const copyGoogleLink = async () => {
    if (!googleMapsUrl) return;
    try {
      await navigator.clipboard.writeText(googleMapsUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      window.prompt('Copie ce lien :', googleMapsUrl);
    }
  };

  const openGoogle = () => {
    if (!canUseGoogle) return;
    onOpenGoogleMaps();
    setOpened(true);
    window.setTimeout(() => setOpened(false), 1100);
  };

  const topBtnBase = 'px-4 py-2 rounded text-white transition disabled:cursor-not-allowed';
  const topBtnDisabled = 'bg-gray-700/60 text-white/50';
  const topBtnEnabled = 'bg-blue-600 hover:bg-blue-700';

  const itemBase = 'border p-3 rounded cursor-pointer transition';
  const itemFocused = 'ring-2 ring-blue-400 bg-gray-200';
  const itemHover = 'hover:bg-gray-100';

  const attachHoverHandlers = (id: number) => ({
    onMouseEnter: () => onHoverTarget?.(id),
    onMouseLeave: () => onHoverTarget?.(null),
  });

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3 gap-4">
          <h2 className="text-2xl font-semibold whitespace-nowrap">Targets actifs</h2>

          <div className="flex items-center gap-3 w-full justify-end">
            <div className="relative w-full max-w-md">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher une adresse…"
                className="w-full border rounded px-3 py-2 pr-10"
              />
              {isFiltering ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-black"
                  aria-label="Clear search"
                  title="Effacer"
                >
                  ×
                </button>
              ) : null}
            </div>

            <span className="text-sm text-gray-400 whitespace-nowrap">
              Tournée {safeTourIds.length}/{TOUR_MAX}
            </span>

            <button
              type="button"
              onClick={openGoogle}
              disabled={!canUseGoogle}
              className={[topBtnBase, canUseGoogle ? topBtnEnabled : topBtnDisabled].join(' ')}
              title={canUseGoogle ? 'Ouvrir l’itinéraire à pied' : 'Ajoute au moins 2 points'}
            >
              {opened ? 'Ouvert ✓' : 'Google Maps'}
            </button>

            <button
              type="button"
              onClick={copyGoogleLink}
              disabled={!googleMapsUrl}
              className={[topBtnBase, googleMapsUrl ? topBtnEnabled : topBtnDisabled].join(' ')}
              title={googleMapsUrl ? 'Copier le lien' : 'Lien indisponible'}
            >
              {copied ? 'Copié ✓' : 'Copier le lien'}
            </button>

            <button
              onClick={onAutoTour}
              disabled={tourLoading}
              className={[topBtnBase, !tourLoading ? topBtnEnabled : topBtnDisabled].join(' ')}
              title={safeTourIds.length > 0 ? 'Vider la tournée' : 'Générer une tournée'}
            >
              {tourLoading
                ? 'Génération…'
                : safeTourIds.length > 0
                ? 'Réinitialiser la tournée'
                : 'Tournée automatique'}
            </button>
          </div>
        </div>

        {safeActive.length === 0 ? (
          <div className="text-gray-500">{emptyState?.message ?? 'Job’s done ✅'}</div>
        ) : filteredActive.length === 0 ? (
          <div className="text-gray-500">
            Aucun résultat{isFiltering ? ` pour “${query.trim()}”` : ''}.
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredActive.map((t) => {
              const inTour = tourSet.has(t.id);
              const tourEligible = t.status === 'non_traite';
              const pos = tourIndex.get(t.id);
              const isFocused = focusedTargetId === t.id;

              const detailLines = formatTargetDetails(t);
              const notesKey = buildNotesKey(t);

              return (
                <li
                  key={t.id}
                  {...attachHoverHandlers(t.id)}
                  onClick={() => onFocusTarget(t.id)}
                  className={[itemBase, isFocused ? itemFocused : itemHover].join(' ')}
                  title="Centrer sur la carte"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong>{t.address}</strong>
                        {pos ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white">
                            #{pos}
                          </span>
                        ) : null}
                      </div>

                      {/* ✅ NO PLACEHOLDER: only show if we have raw details */}
                      {detailLines.length > 0 ? (
                        <div className="text-sm text-gray-600 mt-1 space-y-0.5">
                          {detailLines.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      ) : null}

                      <div className="text-sm text-gray-400 mt-1">
                        {t.surface ?? '—'} m² — <span className="font-mono">{t.status}</span>
                      </div>

                      {/* ✅ Remove "()" bug: only render date line if exists */}
                      {t.date ? <div className="text-sm text-gray-500 mt-1">{t.date}</div> : null}
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end">
                      {tourEligible ? (
                        inTour ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveFromTour(t.id);
                            }}
                            className="px-3 py-1 bg-blue-100 text-blue-900 rounded"
                          >
                            Retirer
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToTour(t.id);
                            }}
                            disabled={tourFull}
                            className={
                              tourFull
                                ? 'px-3 py-1 bg-gray-200 text-gray-500 rounded cursor-not-allowed'
                                : 'px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700'
                            }
                            title={
                              tourFull ? `Limite atteinte (${TOUR_MAX})` : 'Ajouter à la tournée'
                            }
                          >
                            Ajouter
                          </button>
                        )
                      ) : null}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDone(t.id);
                        }}
                        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition"
                      >
                        Terminé
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRepasser(t.id, 7);
                        }}
                        className="px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 transition"
                      >
                        Repasser J+7
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onIgnore(t.id);
                        }}
                        className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 transition"
                      >
                        Ignorer
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenNotes(notesKey);
                        }}
                        className="px-3 py-1 bg-black text-white rounded hover:opacity-90 transition"
                        title={
                          notesKey === t.address
                            ? 'Notes (adresse)'
                            : 'Notes (adresse + complément)'
                        }
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

      <details className="border rounded">
        <summary className="cursor-pointer select-none px-4 py-3 font-semibold">
          Inactifs ({filteredInactive.length}/{safeInactive.length})
        </summary>

        <div className="px-4 pb-4">
          {safeInactive.length === 0 ? (
            <div className="text-gray-500 mt-2">Aucun target inactif.</div>
          ) : filteredInactive.length === 0 ? (
            <div className="text-gray-500 mt-2">
              Aucun résultat{isFiltering ? ` pour “${query.trim()}”` : ''}.
            </div>
          ) : (
            <ul className="space-y-2 mt-3">
              {filteredInactive.map((t) => {
                const isFocused = focusedTargetId === t.id;
                const detailLines = formatTargetDetails(t);
                const notesKey = buildNotesKey(t);

                return (
                  <li
                    key={t.id}
                    {...attachHoverHandlers(t.id)}
                    onClick={() => onFocusTarget(t.id)}
                    className={[itemBase, isFocused ? itemFocused : itemHover].join(' ')}
                    title="Centrer sur la carte"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div>
                          <strong>{t.address}</strong> — {t.surface ?? '—'} m² —{' '}
                          <span className="font-mono">{t.status}</span>
                        </div>

                        {/* ✅ same RAW display rules */}
                        {detailLines.length > 0 ? (
                          <div className="text-sm text-gray-600 mt-1 space-y-0.5">
                            {detailLines.map((line, i) => (
                              <div key={i}>{line}</div>
                            ))}
                          </div>
                        ) : null}

                        {t.date ? <div className="text-sm text-gray-500 mt-1">{t.date}</div> : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onReset(t.id);
                          }}
                          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                        >
                          Remettre à faire
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenNotes(notesKey);
                          }}
                          className="px-3 py-1 bg-black text-white rounded hover:opacity-90 transition"
                          title={
                            notesKey === t.address
                              ? 'Notes (adresse)'
                              : 'Notes (adresse + complément)'
                          }
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
      </details>
    </section>
  );
}
