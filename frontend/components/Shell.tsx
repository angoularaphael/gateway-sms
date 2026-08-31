"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getToken } from "@/lib/api";
import { useEffect } from "react";

const NAV = [
  { href: "/", label: "Stats" },
  { href: "/campaigns", label: "Campagnes" },
  { href: "/devices", label: "Téléphones" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-[#1d3348] bg-[#0a1622] p-5 md:block">
        <div className="mb-8 text-lg font-semibold tracking-wide text-[#3ee0b0]">SMS Gateway</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm ${
                item.href === "/"
                  ? path === "/"
                    ? "bg-[#122536] text-white"
                    : "text-[#8aa4b8] hover:bg-[#122536] hover:text-white"
                  : path === item.href || path.startsWith(`${item.href}/`)
                    ? "bg-[#122536] text-white"
                    : "text-[#8aa4b8] hover:bg-[#122536] hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          className="mt-10 text-sm text-[#8aa4b8] hover:text-white"
          onClick={() => {
            clearToken();
            router.push("/login");
          }}
        >
          Déconnexion
        </button>
      </aside>
      <div className="md:pl-56">
        <header className="flex items-center justify-between border-b border-[#1d3348] px-4 py-3 md:hidden">
          <span className="font-semibold text-[#3ee0b0]">SMS Gateway</span>
          <nav className="flex gap-3 text-xs text-[#8aa4b8]">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl p-6">{children}</main>
      </div>
    </div>
  );
}
