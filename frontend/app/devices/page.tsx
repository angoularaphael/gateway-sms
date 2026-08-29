"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type Sim = {
  id: string;
  slot: number;
  status: string;
  phoneNumber: string | null;
  enabled: boolean;
  dailyLimit: number;
  ratePerMinute: number;
};

type Device = {
  deviceId: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  appVersion: string | null;
  simLines: Sim[];
  messagesSent: number;
  errors: number;
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<{ device: { deviceId: string }; apiKey: string } | null>(null);

  async function load() {
    setDevices(await api<Device[]>("/api/devices"));
  }

  useEffect(() => {
    load().catch(() => undefined);
    const t = setInterval(() => load().catch(() => undefined), 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Téléphones</h1>
        <button
          className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]"
          onClick={async () => {
            const result = await api<{ device: { deviceId: string }; apiKey: string }>("/api/devices/register", {
              method: "POST",
              body: JSON.stringify({ name: "Nouveau téléphone" }),
            });
            setPairing(result);
            await load();
          }}
        >
          Enregistrer un téléphone
        </button>
      </div>
      {pairing && (
        <div className="mb-6 rounded-2xl border border-[#3ee0b0] bg-[#0e1c2b] p-4 text-sm">
          <p>
            Identifiant : <strong>{pairing.device.deviceId}</strong>
          </p>
          <p className="mt-1 break-all">
            Clé API (à copier maintenant) : <strong>{pairing.apiKey}</strong>
          </p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {devices.map((d) => (
          <article key={d.deviceId} className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-medium">{d.deviceId}</h2>
              <span className={d.status === "ONLINE" ? "text-[#3ee0b0]" : "text-[#ff6b6b]"}>
                {d.status === "ONLINE" ? "🟢 ONLINE" : "🔴 OFFLINE"}
              </span>
            </div>
            <p className="text-sm text-[#8aa4b8]">
              Dernière activité : {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString("fr-FR") : "jamais"}
              <br />
              Version app : {d.appVersion ?? "—"}
              <br />
              Messages : {d.messagesSent} · Erreurs : {d.errors}
            </p>
            <ul className="mt-4 space-y-2">
              {d.simLines.map((s) => (
                <li key={s.id} className="rounded-lg bg-[#07111c] p-3 text-sm">
                  SIM {s.slot} {s.status === "READY" && s.enabled ? "🟢" : "🔴"} {s.phoneNumber ?? ""}
                  <div className="mt-1 text-[#8aa4b8]">
                    {s.dailyLimit}/jour · {s.ratePerMinute}/min · {s.enabled ? "activée" : "désactivée"}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Shell>
  );
}
