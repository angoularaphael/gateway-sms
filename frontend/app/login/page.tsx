"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@localhost");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await api<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(result.token);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de connexion");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-8">
        <h1 className="mb-1 text-2xl font-semibold">SMS Gateway</h1>
        <p className="mb-6 text-sm text-[#8aa4b8]">Connexion au tableau de bord</p>
        <label className="mb-3 block text-sm">
          Email
          <input
            className="mt-1 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="mb-4 block text-sm">
          Mot de passe
          <input
            className="mt-1 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            minLength={8}
            required
          />
        </label>
        {error && <p className="mb-3 text-sm text-[#ff6b6b]">{error}</p>}
        <button className="w-full rounded-lg bg-[#3ee0b0] py-2 font-medium text-[#07111c]">Se connecter</button>
      </form>
    </div>
  );
}
