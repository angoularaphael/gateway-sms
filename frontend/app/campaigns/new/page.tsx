"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type List = { id: string; name: string };

export default function NewCampaignPage() {
  const router = useRouter();
  const [lists, setLists] = useState<List[]>([]);
  const [name, setName] = useState("Offre Boxing Center — dernières places");
  const [message, setMessage] = useState(`Bonjour {prenom},

DERNIERES PLACES pour l'offre Boxing Center.

Il reste encore quelques places.

29 € / 4 semaines
- Sans engagement
- Sans preavis en cas de resiliation
- Acces aux 5 salles, toutes les disciplines et tous les cours

259 € / 12 mois
- Au lieu de 400 €
- Paiement 4 fois sans frais
- Acces aux 5 salles, toutes les disciplines et tous les cours

Profite de ton offre avant qu'il ne soit trop tard.

Tout se passe ici :
https://boutique.boxingcenter.fr/offres-speciales

29€ sans engagement, 259€ pour 12 mois`);
  const [listId, setListId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Array<List & { _count?: { members: number } }>>("/api/contact-lists")
      .then((rows) => {
        setLists(rows);
        const offre = rows.find((l) => l.id === "seed-offre-bc" || l.name.toLowerCase().includes("boxing"));
        if (offre) setListId(offre.id);
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await api<{ id: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name, message, listId: listId || undefined, scheduledAt: scheduledAt || undefined }),
      });
      router.push(`/campaigns/detail/?id=${created.id}`);
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
          <textarea className="mt-1 h-64 w-full whitespace-pre-wrap rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={message} onChange={(e) => setMessage(e.target.value)} required />
        </label>
        <p className="text-xs text-[#8aa4b8]">Placeholders : {"{prenom}"} {"{nom}"} {"{telephone}"}</p>
        <div className="rounded-lg bg-[#07111c] p-3 text-sm">
          <div className="mb-1 text-[#8aa4b8]">Aperçu</div>
          <pre className="whitespace-pre-wrap font-sans">
            {message.replace("{prenom}", "Jean").replace("{nom}", "Dupont").replace("{telephone}", "+33612345678")}
          </pre>
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
