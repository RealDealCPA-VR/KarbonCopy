import type { EntityType } from "@/db/schema";

export const ENTITY_TYPES: { value: EntityType; label: string; short: string }[] = [
  { value: "individual", label: "Individual", short: "Indiv" },
  { value: "sole_prop", label: "Sole Proprietor", short: "Sole Prop" },
  { value: "partnership", label: "Partnership", short: "Partnership" },
  { value: "s_corp", label: "S-Corporation", short: "S-Corp" },
  { value: "c_corp", label: "C-Corporation", short: "C-Corp" },
  { value: "llc", label: "LLC", short: "LLC" },
  { value: "nonprofit", label: "Nonprofit", short: "Nonprofit" },
  { value: "trust", label: "Trust", short: "Trust" },
  { value: "estate", label: "Estate", short: "Estate" },
  { value: "other", label: "Other", short: "Other" },
];

const LABEL_MAP = new Map(ENTITY_TYPES.map((e) => [e.value, e]));

export function entityTypeLabel(t: EntityType | string | null | undefined): string {
  if (!t) return "—";
  return LABEL_MAP.get(t as EntityType)?.label ?? "Other";
}

export function entityTypeShort(t: EntityType | string | null | undefined): string {
  if (!t) return "—";
  return LABEL_MAP.get(t as EntityType)?.short ?? "Other";
}

/** Mask an EIN for display: ••-•••XXXX (last 4 visible). */
export function maskEin(ein: string | null | undefined): string {
  if (!ein) return "";
  const digits = ein.replace(/\D/g, "");
  if (digits.length < 4) return "••-•••" + digits;
  return "••-•••" + digits.slice(-4);
}

/** Format MM-DD fiscal year end into "Mon DD". */
export function formatFiscalYearEnd(fye: string | null | undefined): string {
  if (!fye) return "—";
  const [mm, dd] = fye.split("-");
  const m = Number(mm);
  if (!m || m < 1 || m > 12) return fye;
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${MONTHS[m - 1]} ${dd ?? ""}`.trim();
}
