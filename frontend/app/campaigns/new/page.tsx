"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { OFFER_MESSAGE } from "@/lib/offerMessage";

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("Offre Boxing Center");
  const [message, setMessage] = useState(OFFER_MESSAGE);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const created = await api<{ id: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name, message }),
      });
      router.push(`/campaigns/detail/?id=${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <Shell>
      <h1 className="mb-2 text-3xl font-semibold">Nouvelle campagne</h1>
      <p className="mb-6 text-sm text-[#8aa4b8]">Tu ajouteras les numéros ensuite, en ouvrant la campagne.</p>
      <form onSubmit={onSubmit} className="max-w-xl space-y-4 rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-6">
        <label className="block text-sm">
          Nom
          <input className="mt-1 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          Message
          <textarea className="mt-1 h-56 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={message} onChange={(e) => setMessage(e.target.value)} required />
        </label>
        <p className="text-xs text-[#8aa4b8]">{"{prenom}"} est remplacé par le prénom du contact.</p>
        {error && <p className="text-[#ff6b6b]">{error}</p>}
        <button className="rounded-lg bg-[#3ee0b0] px-4 py-2 font-medium text-[#07111c]">Créer</button>
      </form>
    </Shell>
  );
}
