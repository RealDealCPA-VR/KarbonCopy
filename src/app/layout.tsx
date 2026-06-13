import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "KarbonCopy — Practice Management",
  description: "Local-first CPA firm practice management with file-server alerts",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers userId={user?.id}>{children}</Providers>
      </body>
    </html>
  );
}
