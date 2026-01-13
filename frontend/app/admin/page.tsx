/**
 * ─────────────────────────────────────────────────────────────
 * Project : prospector
 * File    : page.tsx (Admin)
 * Author  : Antoine Astruc
 * Email   : antoine@maisonastruc.fr
 * Created : 2026-01-12
 * License : MIT
 * ─────────────────────────────────────────────────────────────
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import AdminMapDraw from "../components/AdminMapDraw";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// MVP no-auth : tu incarnes l'admin
const ADMIN_USER_ID = 1;

type AdminUser = {
  id: number;
  name: string;
  email: string | null;
  agency_id: number;
  role: string;
  min_surface_m2: number | null;
  max_surface_m2: number | null;
  has_territory: boolean;
};

type ZoneItem = {
  id: number;
  name: string;
  geojson: string; // string JSON depuis backend
};

type MapMode = "territory" | "bu_zone";

export default function AdminPage() {
  const [agencyId, setAgencyId] = useState<number>(1);

  // ✅ NEW: map mode toggle
  const [mapMode, setMapMode] = useState<MapMode>("territory");

  // Create user form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newMin, setNewMin] = useState<string>("");
  const [newMax, setNewMax] = useState<string>("");

  // Users list
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // ✅ shared hover between list <-> map
  const [hoveredUserId, setHoveredUserId] = useState<number | null>(null);

  // ✅ BU Zone (for map context + BU zone editor)
  const [zone, setZone] = useState<ZoneItem | null>(null);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  // ---------------------------------------------------------------------------
  // ✅ Load BU zone for selected agency (admin endpoint)
  // ---------------------------------------------------------------------------
  const loadBuZone = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/admin/zone?agency_id=${agencyId}&admin_user_id=${ADMIN_USER_ID}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        setZone(null);
        return;
      }
      const data = await res.json();
      if (!data?.item) {
        setZone(null);
        return;
      }
      setZone(data.item as ZoneItem);
    } catch {
      setZone(null);
    }
  };

  useEffect(() => {
    void loadBuZone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  // ---------------------------------------------------------------------------
  // Load users
  // ---------------------------------------------------------------------------
  const loadUsers = async () => {
    const res = await fetch(
      `${API_BASE}/admin/users?admin_user_id=${ADMIN_USER_ID}&agency_id=${agencyId}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      alert("Erreur: impossible de charger les users");
      return;
    }
    const data = await res.json();
    setUsers(data.items ?? []);
  };

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  // ---------------------------------------------------------------------------
  // Create user
  // ---------------------------------------------------------------------------
  const createUser = async () => {
    const name = newName.trim();
    if (!name) return;

    const email = newEmail.trim();
    const min = newMin.trim() === "" ? null : Number(newMin);
    const max = newMax.trim() === "" ? null : Number(newMax);

    const res = await fetch(`${API_BASE}/admin/users?admin_user_id=${ADMIN_USER_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: email === "" ? null : email,
        agency_id: agencyId,
        min_surface_m2: Number.isFinite(min as any) ? min : null,
        max_surface_m2: Number.isFinite(max as any) ? max : null,
      }),
    });

    if (!res.ok) {
      const msg = await res.text();
      alert(`Erreur create user: ${msg}`);
      return;
    }

    const data = await res.json();
    const createdId = data?.item?.id as number | undefined;

    setNewName("");
    setNewEmail("");
    setNewMin("");
    setNewMax("");

    await loadUsers();
    if (createdId) setSelectedUserId(createdId);
  };

  // ---------------------------------------------------------------------------
  // ✅ Mode-aware handlers (avoid confusion when editing BU zone)
  // ---------------------------------------------------------------------------
  const handleSelectUserId = (id: number) => {
    if (mapMode === "bu_zone") return; // ignore selection in BU zone editor mode
    setSelectedUserId(id);
  };

  const handleHoverUserId = (id: number | null) => {
    if (mapMode === "bu_zone") return; // ignore hover in BU zone editor mode
    setHoveredUserId(id);
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  return (
    <main className="p-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold">PROSPECTOR — Admin</h1>
        <div className="text-sm text-gray-600">
          Admin user id: <span className="font-mono">{ADMIN_USER_ID}</span>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* LEFT: controls */}
        <div className="space-y-6">
          {/* Agency selector */}
          <div className="border rounded p-4 space-y-3">
            <div className="font-semibold">Agency (BU)</div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                className="border rounded px-3 py-2 w-32"
                value={agencyId}
                onChange={(e) => setAgencyId(Number(e.target.value) || 1)}
              />
              <button
                className="px-3 py-2 border rounded"
                onClick={async () => {
                  await loadUsers();
                  await loadBuZone();
                }}
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Create user */}
          <div className="border rounded p-4 space-y-3">
            <div className="font-semibold">Créer un agent</div>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Nom (ex: Jean Dupont)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Email (optionnel MVP)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className="border rounded px-3 py-2 w-full"
                placeholder="min surface (optionnel)"
                value={newMin}
                onChange={(e) => setNewMin(e.target.value)}
              />
              <input
                className="border rounded px-3 py-2 w-full"
                placeholder="max surface (optionnel)"
                value={newMax}
                onChange={(e) => setNewMax(e.target.value)}
              />
            </div>
            <button className="px-3 py-2 bg-blue-600 text-white rounded w-fit" onClick={createUser}>
              Créer
            </button>
          </div>

          {/* Users list */}
          <div className="border rounded p-4 space-y-3">
            <div className="font-semibold">Users (BU {agencyId})</div>

            {users.length === 0 ? (
              <div className="text-sm text-gray-500">Aucun user.</div>
            ) : (
              <ul className="space-y-2">
                {users.map((u) => {
                  const selected = u.id === selectedUserId;
                  const hovered = u.id === hoveredUserId;

                  return (
                    <li
                      key={u.id}
                      onClick={() => handleSelectUserId(u.id)}
                      onMouseEnter={() => handleHoverUserId(u.id)}
                      onMouseLeave={() => handleHoverUserId(null)}
                      className={[
                        "border rounded p-3 cursor-pointer transition",
                        selected ? "ring-2 ring-blue-400 bg-gray-100" : hovered ? "bg-gray-50" : "hover:bg-gray-50",
                        mapMode === "bu_zone" ? "opacity-60 cursor-not-allowed" : "",
                      ].join(" ")}
                      title={
                        mapMode === "bu_zone"
                          ? "Mode Zone BU actif : repasse en Micro-zones pour éditer un agent."
                          : "Hover = highlight zone sur la carte, Click = sélectionner"
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">
                          {u.name} <span className="text-xs text-gray-500 font-mono">#{u.id}</span>
                        </div>

                        {u.has_territory ? (
                          <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-900">micro-zone ✅</span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-900">micro-zone ❌</span>
                        )}
                      </div>

                      <div className="text-xs text-gray-500 mt-1 space-y-1">
                        <div>
                          role: <span className="font-mono">{u.role}</span> ·{" "}
                          {u.email ? <span className="font-mono">{u.email}</span> : "email: —"}
                        </div>
                        <div>
                          surface: {u.min_surface_m2 ?? "—"} → {u.max_surface_m2 ?? "—"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT: map + draw */}
        <div className="lg:col-span-2 space-y-4">
          {/* ✅ Mode switch + context */}
          <div className="border rounded p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="font-semibold">
                {mapMode === "bu_zone" ? "Zone BU editor (garde-fou)" : "Micro-zone editor"}
              </div>

              <div className="flex items-center gap-2">
                <button
                  className={mapMode === "territory" ? "px-3 py-2 bg-black text-white rounded" : "px-3 py-2 border rounded"}
                  onClick={() => setMapMode("territory")}
                >
                  Micro-zones agents
                </button>
                <button
                  className={mapMode === "bu_zone" ? "px-3 py-2 bg-black text-white rounded" : "px-3 py-2 border rounded"}
                  onClick={() => setMapMode("bu_zone")}
                >
                  Zone BU
                </button>
              </div>
            </div>

            {mapMode === "territory" ? (
              <>
                <div className="text-sm text-gray-600">
                  User sélectionné :{" "}
                  <span className="font-mono">{selectedUser ? `${selectedUser.name} (#${selectedUser.id})` : "—"}</span>
                </div>
                <div className="text-xs text-gray-500">
                  Hover un agent ↔ highlight sur la carte. Clique sur une microzone ↔ sélectionne l’agent.
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-gray-600">
                  Zone BU actuelle :{" "}
                  <span className="font-mono">{zone ? `${zone.name} (#${zone.id})` : "— (aucune zone liée)"}</span>
                </div>
                <div className="text-xs text-gray-500">
                  Dessine le polygone qui définit le garde-fou BU. Sans Zone BU, l’agent ne verra rien.
                </div>
              </>
            )}
          </div>

          <AdminMapDraw
            apiBase={API_BASE}
            adminUserId={ADMIN_USER_ID}
            agencyId={agencyId}
            users={users}
            selectedUserId={selectedUserId}
            hoveredUserId={hoveredUserId}
            onSelectUserId={handleSelectUserId}
            onHoverUserId={handleHoverUserId}
            zoneGeoJsonString={zone?.geojson ?? null}
            mode={mapMode}
          />
        </div>
      </section>
    </main>
  );
}
