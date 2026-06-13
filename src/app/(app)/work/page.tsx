import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkViews } from "@/components/work/work-views";
import { loadBoardData } from "./data";

export const dynamic = "force-dynamic";

export default async function WorkPage() {
  const data = await loadBoardData();
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <WorkViews data={data} />
    </Suspense>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-72 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
