"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type List = { id: string; name: string };

export default function NewCampaignPage() {
  const router = useRouter();
  const [lists, setLists] = useState<List[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("Bonjour {prenom}, découvrez notre offre...");
  const [listId, setListId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Array<List & { _count?: { members: number } }>>("/api/contact-lists").then(setLists).catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await api<{ id: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name, message, listId: listId || undefined, scheduledAt: scheduledAt || undefined }),
      });
      router.push(`/campaigns/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <Shell>
      <h1 className="mb-6 text-3xl font-semibold">Nouvelle campagne</h1>
      <form onSubmit={onSubmit} className="max-w-xl space-y-4 rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-6">
        <label className="block text-sm">
          Nom
          <input className="mt-1 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          Liste
          <select className="mt-1 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Tous les contacts</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Message
          <textarea className="mt-1 h-32 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={message} onChange={(e) => setMessage(e.target.value)} required />
        </label>
        <p className="text-xs text-[#8aa4b8]">Placeholders : {"{prenom}"} {"{nom}"} {"{telephone}"}</p>
        <div className="rounded-lg bg-[#07111c] p-3 text-sm">
          <div className="mb-1 text-[#8aa4b8]">Aperçu</div>
          {message.replace("{prenom}", "Jean").replace("{nom}", "Dupont").replace("{telephone}", "+33612345678")}
        </div>
        <label className="block text-sm">
          Programmation (optionnel)
          <input type="datetime-local" className="mt-1 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </label>
        {error && <p className="text-[#ff6b6b]">{error}</p>}
        <button className="rounded-lg bg-[#3ee0b0] px-4 py-2 font-medium text-[#07111c]">Créer</button>
      </form>
    </Shell>
  );
}
