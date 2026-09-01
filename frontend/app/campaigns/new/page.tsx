"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { OFFER_MESSAGE } from "@/lib/offerMessage";

type Sim = { id: string; slot: number; phoneNumber: string | null; enabled: boolean; status: string; sentToday: number; dailyLimit: number };
type Device = { deviceId: string; status: string; simLines: Sim[] };

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("Offre Boxing Center");
  const [message, setMessage] = useState(OFFER_MESSAGE);
  const [simSlot, setSimSlot] = useState<string>("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Device[]>("/api/devices")
      .then(setDevices)
      .catch(() => undefined);
  }, []);

  const sims = devices.flatMap((d) =>
    d.simLines.map((s) => ({
      ...s,
      deviceId: d.deviceId,
      online: d.status === "ONLINE",
    })),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const created = await api<{ id: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name,
          message,
          preferredSimSlot: simSlot ? Number(simSlot) : null,
        }),
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
        <label className="block text-sm">
          SIM d’envoi
          <select className="mt-1 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" value={simSlot} onChange={(e) => setSimSlot(e.target.value)}>
            <option value="">Auto (les 2 SIM à tour de rôle)</option>
            {sims.map((s) => (
              <option key={s.id} value={s.slot} disabled={!s.enabled || s.status !== "READY"}>
                SIM {s.slot} {s.phoneNumber || ""} — {s.sentToday}/{s.dailyLimit} aujourd’hui
                {s.enabled && s.status === "READY" ? "" : " (indisponible)"}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[#8aa4b8]">{"{prenom}"} est remplacé par le prénom du contact.</p>
        {error && <p className="text-[#ff6b6b]">{error}</p>}
        <button className="rounded-lg bg-[#3ee0b0] px-4 py-2 font-medium text-[#07111c]">Créer</button>
      </form>
    </Shell>
  );
}
