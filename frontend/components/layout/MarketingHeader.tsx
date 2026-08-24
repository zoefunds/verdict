import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/casebook", label: "Casebook" },
  { href: "/#recipes", label: "Resolution Recipes" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-outline-variant bg-surface/80 backdrop-blur-glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" aria-label="VERDICT home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-body-sm text-on-surface-variant transition-colors hover:text-on-surface">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">Launch app</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
