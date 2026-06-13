import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { DeadlinesView } from "@/components/deadlines/deadlines-view";
import { loadDeadlines } from "./data";

export const dynamic = "force-dynamic";

export default async function DeadlinesPage() {
  const data = await loadDeadlines();
  return (
    <Suspense fallback={<DeadlinesSkeleton />}>
      <DeadlinesView data={data} />
    </Suspense>
  );
}

function DeadlinesSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
