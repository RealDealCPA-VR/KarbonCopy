import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-center">
      <p className="text-5xl font-bold tracking-tight">404</p>
      <p className="text-muted-foreground">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Back to dashboard
      </Link>
    </div>
  );
}
