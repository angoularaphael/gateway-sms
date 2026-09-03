"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { Suspense } from "react";

type Contact = { id: string; prenom: string; nom: string; telephone: string };
type Recipient = {
  id: string;
  phoneNumber: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  errorDetail: string | null;
  simLine: { slot: number; phoneNumber: string | null } | null;
  contact: { prenom: string; nom: string } | null;
};
type Campaign = {
  id: string;
  name: string;
  message: string;
  status: string;
  preferredSimSlot?: number | null;
  list: { members: Array<{ contact: Contact }> } | null;
  recipients?: Recipient[];
};
type Stats = {
  sent: number;
  failed: number;
  queued: number;
  cancelled: number;
  total: number;
  progress: number;
  delivered?: number;
  receivedPct?: number;
};
type Sim = { id: string; slot: number; phoneNumber: string | null; enabled: boolean; status: string; sentToday: number; dailyLimit: number };
type Device = { deviceId: string; status: string; simLines: Sim[] };

function CampaignDetail() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get("id") ?? "";
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", telephone: "" });
  const [simSlot, setSimSlot] = useState<string>("");
  const [simSlotTouched, setSimSlotTouched] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const contacts = campaign?.list?.members.map((m) => m.contact) ?? [];

  async function load() {
    const c = await api<Campaign>(`/api/campaigns/${id}`);
    setCampaign(c);
    if (!simSlotTouched) {
      setSimSlot(c.preferredSimSlot ? String(c.preferredSimSlot) : "");
    }
    setStats(await api<Stats>(`/api/campaigns/${id}/stats`));
  }

  useEffect(() => {
    if (!id) {
      setError("Campagne introuvable");
      return;
    }
    load().catch((e) => setError(e.message));
    api<Device[]>("/api/devices").then(setDevices).catch(() => undefined);
    const t = setInterval(() => {
      load().catch(() => undefined);
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
      await api(`/api/campaigns/${id}/start`, {
        method: "POST",
        body: JSON.stringify({ preferredSimSlot: simSlot ? Number(simSlot) : null }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function retry() {
    setError("");
    try {
      const out = await api<{ queued: number }>(`/api/campaigns/${id}/retry`, {
        method: "POST",
        body: JSON.stringify({ preferredSimSlot: simSlot ? Number(simSlot) : null }),
      });
      setInfo(`${out.queued} SMS remis en file (échecs + sans accusé de réception)`);
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
          <p className="text-sm text-[#8aa4b8]">
            {campaign.status} · {contacts.length} contact{contacts.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2 text-sm"
            value={simSlot}
            onChange={(e) => {
              setSimSlotTouched(true);
              setSimSlot(e.target.value);
            }}
          >
            <option value="">SIM auto</option>
            {devices.flatMap((d) => d.simLines).map((s) => (
              <option key={s.id} value={s.slot}>
                SIM {s.slot} {s.phoneNumber || ""} ({s.sentToday}/{s.dailyLimit})
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]" onClick={() => void send()}>
            Envoyer
          </button>
          <button className="rounded-lg border border-[#3ee0b0] px-4 py-2 text-sm text-[#3ee0b0]" onClick={() => void retry()}>
            Renvoyer les non reçus
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

      <div className="mb-6 rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-5">
        <h2 className="mb-3 font-medium">Statistiques</h2>
        <div className="mb-3 h-3 overflow-hidden rounded-full bg-[#07111c]">
          <div className="h-full bg-[#3ee0b0]" style={{ width: `${stats?.progress ?? 0}%` }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-5 text-sm">
          <div>
            <div className="text-[#8aa4b8]">Progression</div>
            <div className="text-xl font-semibold">{stats?.progress ?? 0}%</div>
          </div>
          <div>
            <div className="text-[#8aa4b8]">Envoyés (téléphone)</div>
            <div className="text-xl font-semibold text-[#3ee0b0]">{stats?.sent ?? 0}</div>
          </div>
          <div>
            <div className="text-[#8aa4b8]">Reçus (accusé)</div>
            <div className="text-xl font-semibold text-[#3ee0b0]">{stats?.delivered ?? 0}</div>
          </div>
          <div>
            <div className="text-[#8aa4b8]">En attente</div>
            <div className="text-xl font-semibold">{stats?.queued ?? 0}</div>
          </div>
          <div>
            <div className="text-[#8aa4b8]">Échecs</div>
            <div className="text-xl font-semibold text-[#ff6b6b]">{stats?.failed ?? 0}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-[#8aa4b8]">
          « Reçus » = l’opérateur a confirmé la livraison. Si le quota SIM est saturé, le SMS peut être « envoyé » sans être reçu : utilise Renvoyer les non reçus, sur l’autre SIM.
        </p>
      </div>

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

      {(campaign.recipients || []).length > 0 && (
        <div className="mb-6 overflow-x-auto rounded-2xl border border-[#1d3348]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0e1c2b] text-[#8aa4b8]">
              <tr>
                <th className="px-4 py-3">Destinataire</th>
                <th className="px-4 py-3">Téléphone</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">SIM</th>
                <th className="px-4 py-3">Reçu</th>
              </tr>
            </thead>
            <tbody>
              {(campaign.recipients || []).map((r) => (
                <tr key={r.id} className="border-t border-[#1d3348]">
                  <td className="px-4 py-2">{[r.contact?.prenom, r.contact?.nom].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-4 py-2">{r.phoneNumber}</td>
                  <td className="px-4 py-2">
                    {r.status === "DELIVERED"
                      ? "Reçu"
                      : r.status === "SENT"
                        ? "Envoyé, pas d’accusé"
                        : r.status === "FAILED"
                          ? "Échec"
                          : r.status === "SENDING"
                            ? "Envoi…"
                            : r.status === "QUEUED"
                              ? "En file"
                              : r.status}
                    {r.errorDetail ? ` · ${r.errorDetail}` : ""}
                  </td>
                  <td className="px-4 py-2">{r.simLine ? `SIM ${r.simLine.slot}` : "—"}</td>
                  <td className="px-4 py-2">{r.deliveredAt ? new Date(r.deliveredAt).toLocaleString("fr-FR") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
