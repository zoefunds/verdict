import { cn } from "@/lib/utils";

export function Logo({ className, showWordmark = true }: { className?: string; showWordmark?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="28" height="28" rx="6" fill="#00375a" />
        <path d="M14 5v14" stroke="#98cbff" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 8h16" stroke="#98cbff" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 8l-2.5 5a2.5 3 0 0 0 5 0L6 8Z" stroke="#98cbff" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M22 8l-2.5 5a2.5 3 0 0 0 5 0L22 8Z" stroke="#98cbff" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M10 23h8" stroke="#98cbff" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9.5 17.5l2.7 2.7 4.3-5" stroke="#4edea3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {showWordmark && (
        <span className="font-sans text-headline-sm font-semibold tracking-tight text-on-surface">VERDICT</span>
      )}
    </div>
  );
}
