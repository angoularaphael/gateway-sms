"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type Dashboard = {
  contacts: number;
  campaigns: number;
  sent: number;
  failed: number;
  devices: { total: number; online: number };
  current: {
    campaign: { name: string };
    stats: { sent: number; queued: number; failed: number; progress: number };
  } | null;
};

export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setData(await api<Dashboard>("/api/dashboard"));
    }
    load().catch((e) => setError(e instanceof Error ? e.message : "Erreur"));
    const t = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Shell>
      <h1 className="mb-6 text-3xl font-semibold">Stats</h1>
      {error && <p className="mb-4 text-[#ff6b6b]">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="SMS envoyés" value={data?.sent ?? "—"} />
        <Stat title="SMS échoués" value={data?.failed ?? "—"} />
        <Stat title="Campagnes" value={data?.campaigns ?? "—"} />
        <Stat title="Téléphones" value={data ? `${data.devices.online} / ${data.devices.total} en ligne` : "—"} />
      </div>
      {data?.current && (
        <section className="mt-8 rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-6">
          <h2 className="mb-1 text-sm text-[#8aa4b8]">Campagne en cours</h2>
          <p className="mb-4 text-xl font-medium">{data.current.campaign.name}</p>
          <p className="mb-2 text-sm text-[#8aa4b8]">Progression {data.current.stats.progress}%</p>
          <div className="mb-4 h-3 overflow-hidden rounded-full bg-[#07111c]">
            <div className="h-full bg-[#3ee0b0]" style={{ width: `${data.current.stats.progress}%` }} />
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <span>Envoyés : {data.current.stats.sent}</span>
            <span>En attente : {data.current.stats.queued}</span>
            <span>Échecs : {data.current.stats.failed}</span>
          </div>
        </section>
      )}
    </Shell>
  );
}

function Stat({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-5">
      <div className="text-sm text-[#8aa4b8]">{title}</div>
      <div className="mt-2 text-3xl font-semibold">{typeof value === "number" ? value.toLocaleString("fr-FR") : value}</div>
    </div>
  );
}
