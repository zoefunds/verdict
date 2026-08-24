import { FileText, Link2, Receipt, MessageSquareText, Image as ImageIcon } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { Evidence } from "@/types";

const ICONS: Record<Evidence["evidenceType"], React.ElementType> = {
  url: Link2,
  document: FileText,
  image: ImageIcon,
  transaction_record: Receipt,
  text_statement: MessageSquareText,
};

export function EvidenceTimeline({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">No evidence submitted yet.</p>;
  }

  const sorted = [...evidence].sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  return (
    <ol className="relative space-y-6 border-l-2 border-outline-variant pl-6">
      {sorted.map((item) => {
        const Icon = ICONS[item.evidenceType];
        return (
          <li key={item.id} className="relative">
            <span className="absolute -left-[31px] flex h-4 w-4 items-center justify-center rounded-full bg-primary" />
            <div className="rounded-md border border-outline-variant bg-surface-container p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-on-surface">{item.title}</span>
                </div>
                <span className="font-mono text-label-sm text-on-surface-variant">{item.contentHashSha256.slice(0, 12)}…</span>
              </div>
              {item.description && <p className="mt-2 text-body-sm text-on-surface-variant">{item.description}</p>}
              {item.sourceUrl && (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-body-sm text-primary hover:underline">
                  {item.sourceUrl}
                </a>
              )}
              {item.textContent && <p className="mt-2 whitespace-pre-wrap text-body-sm text-on-surface">{item.textContent}</p>}
              <p className="mt-3 font-mono text-label-sm text-on-surface-variant">
                {formatDateTime(item.submittedAt)} · {item.status}
                {item.isAppealEvidence ? " · appeal evidence" : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
