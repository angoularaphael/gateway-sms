"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type Campaign = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  contactsCount?: number;
  _count: { recipients: number };
  stats?: { sent: number; failed: number; queued: number; delivered?: number };
};

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setItems(await api<Campaign[]>("/api/campaigns"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, []);

  async function remove(id: string, name: string) {
    if (!window.confirm(`Supprimer la campagne « ${name} » ?`)) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/campaigns/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Campagnes</h1>
        <Link href="/campaigns/new" className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]">
          Nouvelle campagne
        </Link>
      </div>
      <p className="mb-6 text-sm text-[#8aa4b8]">Clique une campagne pour ajouter tes numéros, puis envoyer.</p>
      {error && <p className="mb-4 text-sm text-[#ff6b6b]">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-[#1d3348]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0e1c2b] text-[#8aa4b8]">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Contacts</th>
              <th className="px-4 py-3">Envoyés</th>
              <th className="px-4 py-3">Reçus</th>
              <th className="px-4 py-3">En attente</th>
              <th className="px-4 py-3">Échecs</th>
              <th className="px-4 py-3">Créée</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t border-[#1d3348]">
                <td className="px-4 py-2">
                  <Link href={`/campaigns/detail/?id=${c.id}`} className="text-[#3ee0b0]">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.status}</td>
                <td className="px-4 py-2">{c.contactsCount ?? c._count.recipients}</td>
                <td className="px-4 py-2 text-[#3ee0b0]">{c.stats?.sent ?? 0}</td>
                <td className="px-4 py-2 text-[#3ee0b0]">{c.stats?.delivered ?? 0}</td>
                <td className="px-4 py-2">{c.stats?.queued ?? 0}</td>
                <td className="px-4 py-2 text-[#ff6b6b]">{c.stats?.failed ?? 0}</td>
                <td className="px-4 py-2">{new Date(c.createdAt).toLocaleString("fr-FR")}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    className="text-[#ff6b6b] disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() => void remove(c.id, c.name)}
                  >
                    {busy === c.id ? "…" : "Supprimer"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
