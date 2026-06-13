import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Secure Document Upload — KarbonCopy",
  description: "Securely upload requested documents to your accounting firm.",
};

/**
 * Public client portal layout. The root layout already provides
 * <html>/<body>/Providers, so this is a self-contained, auth-free wrapper.
 *
 * The portal must look clean/trustworthy in LIGHT mode regardless of the
 * visitor's system theme (next-themes may have set `.dark` on <html>). We
 * pin the light design tokens directly on this wrapper via inline CSS vars so
 * every shadcn primitive rendered inside resolves to the light palette.
 */
const LIGHT_TOKENS: React.CSSProperties & Record<string, string> = {
  "--background": "0 0% 100%",
  "--foreground": "222 47% 11%",
  "--card": "0 0% 100%",
  "--card-foreground": "222 47% 11%",
  "--popover": "0 0% 100%",
  "--popover-foreground": "222 47% 11%",
  "--primary": "221 83% 53%",
  "--primary-foreground": "210 40% 98%",
  "--secondary": "210 40% 96%",
  "--secondary-foreground": "222 47% 11%",
  "--muted": "210 40% 96%",
  "--muted-foreground": "215 16% 47%",
  "--accent": "210 40% 96%",
  "--accent-foreground": "222 47% 11%",
  "--destructive": "0 72% 51%",
  "--destructive-foreground": "210 40% 98%",
  "--success": "142 71% 45%",
  "--success-foreground": "210 40% 98%",
  "--warning": "38 92% 50%",
  "--warning-foreground": "222 47% 11%",
  "--border": "214 32% 91%",
  "--input": "214 32% 91%",
  "--ring": "221 83% 53%",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={LIGHT_TOKENS} className="min-h-screen bg-background text-foreground">
      {children}
    </div>
  );
}
