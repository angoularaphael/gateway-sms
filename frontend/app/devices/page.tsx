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
  sentToday: number;
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [serverUrl, setServerUrl] = useState("http://prem-eu2.bot-hosting.net:21724");

  async function load() {
    setDevices(await api<Device[]>("/api/devices"));
  }

  useEffect(() => {
    if (typeof window !== "undefined") setServerUrl(window.location.origin);
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => undefined), 10_000);
    return () => clearInterval(t);
  }, []);

  async function register() {
    setError("");
    setBusy("register");
    try {
      const result = await api<{ device: { deviceId: string }; apiKey: string }>("/api/devices/register", {
        method: "POST",
        body: JSON.stringify({ name: "Nouveau téléphone" }),
      });
      setPairing(result);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function remove(deviceId: string) {
    if (!window.confirm(`Supprimer ${deviceId} ? La clé API ne fonctionnera plus.`)) return;
    setError("");
    setBusy(deviceId);
    try {
      await api(`/api/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
      if (pairing?.device.deviceId === deviceId) setPairing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSim(sim: Sim, enabled: boolean) {
    setError("");
    try {
      await api(`/api/devices/sims/${sim.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copier :", text);
    }
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Téléphones</h1>
        <button
          className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c] disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void register()}
        >
          Enregistrer un téléphone
        </button>
      </div>

      <div className="mb-6 rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-4 text-sm text-[#8aa4b8]">
        <p className="text-[#e8f1f8]">URL à coller dans l’app (à la place de 10.0.2.2:4000) :</p>
        <p className="mt-1 break-all font-mono text-[#3ee0b0]">{serverUrl}</p>
        <button
          className="mt-2 rounded-lg border border-[#1d3348] px-3 py-1 text-xs text-[#e8f1f8]"
          onClick={() => void copy(serverUrl)}
        >
          Copier l’URL
        </button>
        <p className="mt-3">
          Si le téléphone reste OFFLINE : Wi‑Fi (pas 4G), APK 1.0.6+, puis Connecter. Autorise SMS / téléphone /
          notifications. Sur Android 15, l’APK hors Play Store est bloquée : Paramètres de l’appli → ⋮ →
          Autoriser les réglages restreints, puis « Définir comme appli SMS ». Si le copier-coller dans Messages
          marche mais pas l’envoi auto, l’app doit être l’appli SMS par défaut.
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-[#ff6b6b]">{error}</p>}

      {pairing && (
        <div className="mb-6 rounded-2xl border border-[#3ee0b0] bg-[#0e1c2b] p-4 text-sm">
          <p>
            Identifiant : <strong>{pairing.device.deviceId}</strong>
          </p>
          <p className="mt-1 break-all">
            Clé API (à copier maintenant) : <strong>{pairing.apiKey}</strong>
          </p>
          <button
            className="mt-2 rounded-lg border border-[#1d3348] px-3 py-1 text-xs"
            onClick={() => void copy(pairing.apiKey)}
          >
            Copier la clé
          </button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {devices.map((d) => (
          <article key={d.deviceId} className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
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
                    {s.sentToday ?? 0}/{s.dailyLimit} aujourd’hui · {s.ratePerMinute}/min · {s.enabled ? "activée" : "désactivée"}
                  </div>
                  <button
                    className="mt-2 rounded border border-[#1d3348] px-2 py-1 text-xs"
                    onClick={() => void toggleSim(s, !s.enabled)}
                  >
                    {s.enabled ? "Couper cette SIM" : "Réactiver"}
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="mt-4 rounded-lg border border-[#ff6b6b]/40 px-3 py-2 text-sm text-[#ff6b6b] disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void remove(d.deviceId)}
            >
              {busy === d.deviceId ? "Suppression…" : "Supprimer"}
            </button>
          </article>
        ))}
      </div>
    </Shell>
  );
}
