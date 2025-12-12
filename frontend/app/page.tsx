"use client";

import { useEffect, useState } from "react";
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

export default function Home() {
  const [dpe, setDpe] = useState<DpeItem[]>([]);

  // Charger les DPE depuis l'API dès l'ouverture de la page
  useEffect(() => {
    fetch("http://localhost:8000/dpe")
      .then((res) => res.json())
      .then((data) => {
        setDpe(data.items);
      });
  }, []);

  // Mise à jour du statut d'un DPE (done, ignore)
  const updateStatus = async (id: number, status: string) => {
    await fetch(`http://localhost:8000/dpe/${id}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });

    // Mise à jour immédiate côté frontend pour re-render instantané
    setDpe((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status } : item
      )
    );
  };

  return (
    <main className="p-10">
      <h1 className="text-4xl font-bold mb-6">HELLO PROSPECTOR</h1>

      <h2 className="text-2xl font-semibold mb-4">DPE reçus :</h2>

      <ul className="space-y-2">
        {dpe.map((item) => (
          <li key={item.id} className="border p-3 rounded">
            <strong>{item.address}</strong> — {item.surface} m² —{" "}
            <span className="font-mono">{item.status}</span>

            <div className="flex gap-2 mt-2">
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
            </div>

            <span className="text-sm text-gray-500 block mt-1">
              ({item.date})
            </span>
          </li>
        ))}
      </ul>

      <h2 className="text-2xl font-semibold mt-10 mb-4">Carte :</h2>
      <Map dpe={dpe} />
    </main>
  );
}
