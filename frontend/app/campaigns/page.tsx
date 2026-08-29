"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

type Campaign = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  _count: { recipients: number };
};

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);

  useEffect(() => {
    api<Campaign[]>("/api/campaigns").then(setItems).catch(() => undefined);
  }, []);

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Campagnes</h1>
        <Link href="/campaigns/new" className="rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]">
          Nouvelle campagne
        </Link>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[#1d3348]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0e1c2b] text-[#8aa4b8]">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Destinataires</th>
              <th className="px-4 py-3">Créée</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t border-[#1d3348]">
                <td className="px-4 py-2">
                  <Link href={`/campaigns/${c.id}`} className="text-[#3ee0b0]">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.status}</td>
                <td className="px-4 py-2">{c._count.recipients}</td>
                <td className="px-4 py-2">{new Date(c.createdAt).toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
