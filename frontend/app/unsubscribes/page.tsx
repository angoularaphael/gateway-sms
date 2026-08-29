"use client";

import { FormEvent, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type Row = { id: string; telephone: string; reason: string | null; createdAt: string };

export default function UnsubscribesPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [telephone, setTelephone] = useState("");

  async function load() {
    setItems(await api<Row[]>("/api/unsubscribes"));
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await api("/api/unsubscribe", { method: "POST", body: JSON.stringify({ telephone, reason: "manuel" }) });
    setTelephone("");
    await load();
  }

  return (
    <Shell>
      <h1 className="mb-6 text-3xl font-semibold">Désinscriptions</h1>
      <form onSubmit={onSubmit} className="mb-6 flex max-w-md gap-2">
        <input className="flex-1 rounded-lg border border-[#1d3348] bg-[#0e1c2b] px-3 py-2" placeholder="Téléphone" value={telephone} onChange={(e) => setTelephone(e.target.value)} required />
        <button className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]">Ajouter</button>
      </form>
      <ul className="divide-y divide-[#1d3348] rounded-2xl border border-[#1d3348]">
        {items.map((u) => (
          <li key={u.id} className="flex justify-between px-4 py-3 text-sm">
            <span>{u.telephone}</span>
            <span className="text-[#8aa4b8]">{u.reason ?? ""} · {new Date(u.createdAt).toLocaleDateString("fr-FR")}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
