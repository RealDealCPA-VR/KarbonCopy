"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">This page hit an error</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            {error.message === "FORBIDDEN"
              ? "You don't have permission to do that."
              : "Something went wrong loading this view. Your data is safe."}
          </p>
          <Button onClick={reset} className="mt-1">
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
