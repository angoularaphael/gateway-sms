"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type Campaign = { id: string; name: string; message: string; status: string; scheduledAt: string | null };
type Preview = { recipients: number; unsubscribed: number; estimate: { segments: number }; preview: string };
type Stats = { sent: number; failed: number; queued: number; cancelled: number; total: number; progress: number };

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const c = await api<Campaign>(`/api/campaigns/${params.id}`);
    setCampaign(c);
    setPreview(await api<Preview>(`/api/campaigns/${params.id}/preview`));
    setStats(await api<Stats>(`/api/campaigns/${params.id}/stats`));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [params.id]);

  async function action(path: string) {
    await api(`/api/campaigns/${params.id}/${path}`, { method: "POST" });
    await load();
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
      <h1 className="mb-2 text-3xl font-semibold">{campaign.name}</h1>
      <p className="mb-6 text-[#8aa4b8]">{campaign.status}</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status) && (
          <button className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]" onClick={() => action("start")}>
            Lancer
          </button>
        )}
        {campaign.status === "RUNNING" && (
          <button className="rounded-lg border border-[#1d3348] px-4 py-2 text-sm" onClick={() => action("pause")}>
            Pause
          </button>
        )}
        {campaign.status === "PAUSED" && (
          <button className="rounded-lg border border-[#1d3348] px-4 py-2 text-sm" onClick={() => action("resume")}>
            Reprendre
          </button>
        )}
        {!["COMPLETED", "CANCELLED"].includes(campaign.status) && (
          <button className="rounded-lg border border-[#ff6b6b] px-4 py-2 text-sm text-[#ff6b6b]" onClick={() => action("cancel")}>
            Annuler
          </button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-5">
          <h2 className="mb-2 font-medium">Aperçu</h2>
          <p className="mb-3 whitespace-pre-wrap text-sm">{preview?.preview}</p>
          <p className="text-sm text-[#8aa4b8]">
            Destinataires : {preview?.recipients ?? 0} · Désinscrits exclus : {preview?.unsubscribed ?? 0}
            <br />
            Estimation SMS : {preview?.estimate.segments ?? 0} segments
          </p>
        </div>
        <div className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-5">
          <h2 className="mb-2 font-medium">Statistiques</h2>
          <div className="mb-3 h-3 overflow-hidden rounded-full bg-[#07111c]">
            <div className="h-full bg-[#3ee0b0]" style={{ width: `${stats?.progress ?? 0}%` }} />
          </div>
          <ul className="space-y-1 text-sm">
            <li>Progression : {stats?.progress ?? 0}%</li>
            <li>Envoyés : {stats?.sent ?? 0}</li>
            <li>En attente : {stats?.queued ?? 0}</li>
            <li>Échecs : {stats?.failed ?? 0}</li>
            <li>Annulés : {stats?.cancelled ?? 0}</li>
          </ul>
        </div>
      </div>
    </Shell>
  );
}
