import Link from "next/link";
import { Logo } from "@/components/Logo";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "/casebook", label: "Casebook" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/cases/new", label: "Create a case" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/#how-it-works", label: "Procedural rigor" },
      { href: "/#constitution", label: "Constitutional evolution" },
      { href: "/#appeals", label: "Appeals" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/#trust", label: "Trust & security" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-outline-variant bg-surface-container-lowest">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-body-sm text-on-surface-variant">
              Put money behind your version of reality. A collateralized, evidence-based dispute-resolution
              protocol — not gambling, not a prediction market.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-label-md uppercase tracking-wide text-on-surface-variant">{col.title}</h4>
              <ul className="mt-4 space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-body-sm text-on-surface-variant hover:text-on-surface">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 border-t border-outline-variant pt-6 text-body-sm text-on-surface-variant">
          © {new Date().getFullYear()} VERDICT. All disputes are resolved on evidence, not odds.
        </div>
      </div>
    </footer>
  );
}
