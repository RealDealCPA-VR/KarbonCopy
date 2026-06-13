"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export function PayButton({ token }: { token: string }) {
  const [loading, setLoading] = React.useState(false);
  const pay = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/pay/${token}`, { method: "POST" });
      const data = (await r.json()) as { url?: string; error?: string };
      if (r.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      toast.error(data.error ?? "Could not start checkout.");
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button onClick={pay} disabled={loading} className="w-full" size="lg">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pay now"}
    </Button>
  );
}
