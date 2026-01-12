/**
 * ─────────────────────────────────────────────────────────────
 * Project : prospector
 * File    : Admin.tsx
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
  agency_id: number;
  name: string;
  min_surface_m2: number | null;
  max_surface_m2: number | null;
  has_territory: boolean;
};

type ZoneItem = {
  id: number;
  name: string;
  geojson: string; // string JSON depuis backend
};

export default function AdminPage() {
  const [agencyId, setAgencyId] = useState<number>(1);

  // Create user form
  const [newName, setNewName] = useState("");
  const [newMin, setNewMin] = useState<string>("");
  const [newMax, setNewMax] = useState<string>("");

  // Users list
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // BU Zone (for map context)
  const [zone, setZone] = useState<ZoneItem | null>(null);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  // ---------------------------------------------------------------------------
  // Load BU zone (based on ADMIN user agency – OK for MVP)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadZone() {
      try {
        const res = await fetch(`${API_BASE}/me/zone?user_id=${ADMIN_USER_ID}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;

        if (!data?.item) {
          setZone(null);
          return;
        }
        setZone(data.item as ZoneItem);
      } catch {
        setZone(null);
      }
    }

    void loadZone();
    return () => {
      cancelled = true;
    };
  }, []);

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

    const min = newMin.trim() === "" ? null : Number(newMin);
    const max = newMax.trim() === "" ? null : Number(newMax);

    const res = await fetch(`${API_BASE}/admin/users?admin_user_id=${ADMIN_USER_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
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
    setNewMin("");
    setNewMax("");

    await loadUsers();
    if (createdId) setSelectedUserId(createdId);
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
                onChange={(e) => setAgencyId(Number(e.target.value))}
              />
              <button className="px-3 py-2 border rounded" onClick={loadUsers}>
                Refresh
              </button>
            </div>
            <div className="text-xs text-gray-500">
              MVP: tu peux gérer BU=1, puis plus tard on branchera une vraie sélection org/agency.
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
                  return (
                    <li
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={[
                        "border rounded p-3 cursor-pointer transition",
                        selected ? "ring-2 ring-blue-400 bg-gray-100" : "hover:bg-gray-50",
                      ].join(" ")}
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
                      <div className="text-xs text-gray-500 mt-1">
                        surface: {u.min_surface_m2 ?? "—"} → {u.max_surface_m2 ?? "—"}
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
          <div className="border rounded p-4 space-y-2">
            <div className="font-semibold">Micro-zone editor</div>
            <div className="text-sm text-gray-600">
              User sélectionné :{" "}
              <span className="font-mono">{selectedUser ? `${selectedUser.name} (#${selectedUser.id})` : "—"}</span>
            </div>
            <div className="text-xs text-gray-500">
              Dessine un polygone multipoints (quartier par rues), puis “Save”.
            </div>
          </div>

          <AdminMapDraw
            apiBase={API_BASE}
            adminUserId={ADMIN_USER_ID}
            selectedUserId={selectedUserId}
            zoneGeoJsonString={zone?.geojson ?? null}
          />
        </div>
      </section>
    </main>
  );
}
