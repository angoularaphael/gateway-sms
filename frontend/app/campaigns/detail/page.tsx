"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { Suspense } from "react";

type Contact = { id: string; prenom: string; nom: string; telephone: string };
type Campaign = {
  id: string;
  name: string;
  message: string;
  status: string;
  list: { members: Array<{ contact: Contact }> } | null;
};
type Stats = { sent: number; failed: number; queued: number; cancelled: number; total: number; progress: number };

function CampaignDetail() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get("id") ?? "";
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", telephone: "" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const contacts = campaign?.list?.members.map((m) => m.contact) ?? [];

  async function load() {
    const c = await api<Campaign>(`/api/campaigns/${id}`);
    setCampaign(c);
    setStats(await api<Stats>(`/api/campaigns/${id}/stats`));
  }

  useEffect(() => {
    if (!id) {
      setError("Campagne introuvable");
      return;
    }
    load().catch((e) => setError(e.message));
    const t = setInterval(() => {
      api<Stats>(`/api/campaigns/${id}/stats`)
        .then(setStats)
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [id]);

  async function addContact(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      await api(`/api/campaigns/${id}/contacts`, { method: "POST", body: JSON.stringify(form) });
      setForm({ prenom: "", nom: "", telephone: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function importFile(file: File) {
    setError("");
    setInfo("");
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api<{ created: number; skippedDuplicates: number; errors: unknown[] }>(
        `/api/campaigns/${id}/import`,
        { method: "POST", body },
      );
      setInfo(`Import : ${result.created} ajoutés, ${result.skippedDuplicates} déjà présents`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function removeContact(contactId: string) {
    await api(`/api/campaigns/${id}/contacts/${contactId}`, { method: "DELETE" });
    await load();
  }

  async function send() {
    setError("");
    try {
      await api(`/api/campaigns/${id}/start`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  if (!campaign) {
    return (
      <Shell>
        <p>{error || "Chargement…"}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-[#8aa4b8]">{contacts.length} contact{contacts.length > 1 ? "s" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]" onClick={() => void send()}>
            Envoyer
          </button>
          <button
            className="rounded-lg border border-[#ff6b6b] px-4 py-2 text-sm text-[#ff6b6b]"
            onClick={async () => {
              if (!window.confirm("Supprimer cette campagne ?")) return;
              await api(`/api/campaigns/${id}`, { method: "DELETE" });
              router.push("/campaigns");
            }}
          >
            Supprimer
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-[#ff6b6b]">{error}</p>}
      {info && <p className="mb-4 text-sm text-[#3ee0b0]">{info}</p>}

      <div className="mb-6 rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-4 text-sm whitespace-pre-wrap">{campaign.message}</div>

      {(stats?.total ?? 0) > 0 && (
        <p className="mb-6 text-sm text-[#8aa4b8]">
          Envoyés {stats?.sent ?? 0} · En attente {stats?.queued ?? 0} · Échecs {stats?.failed ?? 0}
        </p>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <form onSubmit={addContact} className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-4">
          <h2 className="mb-3 font-medium">Ajouter un numéro</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" placeholder="Prénom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required />
            <input className="rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" placeholder="Nom" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
            <input className="rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" placeholder="Téléphone" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} required />
          </div>
          <button className="mt-3 rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]">Ajouter</button>
        </form>
        <div className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-4">
          <h2 className="mb-3 font-medium">Importer un fichier</h2>
          <p className="mb-2 text-xs text-[#8aa4b8]">CSV : prenom,nom,telephone</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#1d3348]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0e1c2b] text-[#8aa4b8]">
            <tr>
              <th className="px-4 py-3">Prénom</th>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Téléphone</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-[#8aa4b8]" colSpan={4}>
                  Aucun contact. Ajoute un numéro ou importe un CSV, puis Envoyer.
                </td>
              </tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id} className="border-t border-[#1d3348]">
                <td className="px-4 py-2">{c.prenom}</td>
                <td className="px-4 py-2">{c.nom}</td>
                <td className="px-4 py-2">{c.telephone}</td>
                <td className="px-4 py-2 text-right">
                  <button className="text-[#ff6b6b]" onClick={() => void removeContact(c.id)}>
                    Retirer
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

export default function CampaignDetailPage() {
  return (
    <Suspense fallback={<Shell><p>Chargement…</p></Shell>}>
      <CampaignDetail />
    </Suspense>
  );
}
