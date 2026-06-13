import { Badge } from "@/components/ui/badge";
import type { InvoiceStatus } from "@/db/schema";

const MAP: Record<
  InvoiceStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  partial: { label: "Partial", variant: "default" },
  paid: { label: "Paid", variant: "success" },
  overdue: { label: "Overdue", variant: "destructive" },
  void: { label: "Void", variant: "outline" },
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = MAP[status] ?? MAP.draft;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
