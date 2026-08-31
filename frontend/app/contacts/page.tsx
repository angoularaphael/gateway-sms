"use client";

import { FormEvent, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, apiBase } from "@/lib/api";

type Contact = { id: string; prenom: string; nom: string; telephone: string };
type List = { id: string; name: string; _count: { members: number } };

export default function ContactsPage() {
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [lists, setLists] = useState<List[]>([]);
  const [form, setForm] = useState({ prenom: "", nom: "", telephone: "" });
  const [listName, setListName] = useState("");
  const [importListId, setImportListId] = useState("");
  const [message, setMessage] = useState("");

  async function load(q = search) {
    const data = await api<{ items: Contact[]; total: number }>(`/api/contacts?search=${encodeURIComponent(q)}`);
    setItems(data.items);
    setTotal(data.total);
    const nextLists = await api<List[]>("/api/contact-lists");
    setLists(nextLists);
    const offre = nextLists.find((l) => l.id === "seed-offre-bc" || l.name.toLowerCase().includes("boxing"));
    if (offre) setImportListId(offre.id);
  }

  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);

  async function addContact(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    try {
      await api("/api/contacts", {
        method: "POST",
        body: JSON.stringify({ ...form, listId: importListId || undefined }),
      });
      setForm({ prenom: "", nom: "", telephone: "" });
      setMessage("Contact ajouté" + (importListId ? " et mis dans la liste" : ""));
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function importCsv(file: File) {
    const body = new FormData();
    body.append("file", file);
    if (importListId) body.append("listId", importListId);
    const result = await api<{ created: number; skippedDuplicates: number; errors: unknown[] }>("/api/contacts/import", {
      method: "POST",
      body,
    });
    setMessage(`Import : ${result.created} créés, ${result.skippedDuplicates} doublons ignorés, ${result.errors.length} erreurs`);
    await load();
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Contacts</h1>
          <p className="text-sm text-[#8aa4b8]">{total.toLocaleString("fr-FR")} contacts</p>
        </div>
        <div className="flex gap-2">
          <input
            placeholder="Recherche"
            className="rounded-lg border border-[#1d3348] bg-[#0e1c2b] px-3 py-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <a className="rounded-lg border border-[#1d3348] px-3 py-2 text-sm" href={`${apiBase()}/api/contacts/export`}>
            Export CSV
          </a>
        </div>
      </div>

      {message && <p className="mb-4 text-sm text-[#3ee0b0]">{message}</p>}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <form onSubmit={addContact} className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-4">
          <h2 className="mb-3 font-medium">Ajout manuel</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" placeholder="Prénom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required />
            <input className="rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" placeholder="Nom" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
            <input className="rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" placeholder="Téléphone" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} required />
          </div>
          <select
            className="mt-2 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2 text-sm"
            value={importListId}
            onChange={(e) => setImportListId(e.target.value)}
          >
            <option value="">Aucune liste</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {l._count.members} contacts
              </option>
            ))}
          </select>
          <button className="mt-3 rounded-lg bg-[#3ee0b0] px-4 py-2 text-sm font-medium text-[#07111c]">Ajouter</button>
        </form>
        <div className="rounded-2xl border border-[#1d3348] bg-[#0e1c2b] p-4">
          <h2 className="mb-3 font-medium">Import CSV</h2>
          <p className="mb-2 text-xs text-[#8aa4b8]">Colonnes : prenom,nom,telephone</p>
          <select
            className="mb-2 w-full rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2 text-sm"
            value={importListId}
            onChange={(e) => setImportListId(e.target.value)}
          >
            <option value="">Aucune liste (contacts seuls)</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <form
            className="mt-4 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await api("/api/contact-lists", { method: "POST", body: JSON.stringify({ name: listName }) });
              setListName("");
              await load();
            }}
          >
            <input className="flex-1 rounded-lg border border-[#1d3348] bg-[#07111c] px-3 py-2" placeholder="Nouvelle liste" value={listName} onChange={(e) => setListName(e.target.value)} />
            <button className="rounded-lg border border-[#1d3348] px-3 py-2 text-sm">Créer</button>
          </form>
          <ul className="mt-3 space-y-1 text-sm text-[#8aa4b8]">
            {lists.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span>
                  {l.name || "(sans nom)"} — {l._count.members} contacts
                </span>
                <button
                  className="text-[#ff6b6b]"
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Supprimer la liste « ${l.name || "sans nom"} » ?`)) return;
                    await api(`/api/contact-lists/${l.id}`, { method: "DELETE" });
                    if (importListId === l.id) setImportListId("");
                    await load();
                  }}
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
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
            {items.map((c) => (
              <tr key={c.id} className="border-t border-[#1d3348]">
                <td className="px-4 py-2">{c.prenom}</td>
                <td className="px-4 py-2">{c.nom}</td>
                <td className="px-4 py-2">{c.telephone}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    className="text-[#ff6b6b]"
                    onClick={async () => {
                      await api(`/api/contacts/${c.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    Supprimer
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
