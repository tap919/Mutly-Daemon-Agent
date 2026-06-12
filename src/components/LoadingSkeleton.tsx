import type React from "react";

interface LoadingSkeletonProps {
  variant: "card" | "list" | "text" | "chart";
  count?: number;
}

function CardSkeleton(): React.ReactElement {
  return (
    <div className="p-5 rounded-lg border border-zinc-800 bg-zinc-900/20 animate-pulse" aria-busy="true">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 bg-zinc-800 rounded" />
        <div className="h-3 bg-zinc-800 rounded w-20" />
      </div>
      <div className="h-6 bg-zinc-800 rounded w-32" />
    </div>
  );
}

function ListSkeleton(): React.ReactElement {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <div className="w-4 h-4 bg-zinc-800 rounded" />
          <div className="h-3 bg-zinc-800 rounded flex-1" />
          <div className="h-3 bg-zinc-800 rounded w-16" />
        </div>
      ))}
    </div>
  );
}

function TextSkeleton(): React.ReactElement {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true">
      <div className="h-4 bg-zinc-800 rounded w-3/4" />
      <div className="h-4 bg-zinc-800 rounded w-1/2" />
      <div className="h-4 bg-zinc-800 rounded w-5/6" />
    </div>
  );
}

function ChartSkeleton(): React.ReactElement {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true">
      <div className="flex justify-between">
        <div className="h-3 bg-zinc-800 rounded w-24" />
        <div className="h-3 bg-zinc-800 rounded w-12" />
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-2" />
      <div className="flex justify-between">
        <div className="h-3 bg-zinc-800 rounded w-20" />
        <div className="h-3 bg-zinc-800 rounded w-12" />
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-2" />
    </div>
  );
}

const variants: Record<string, () => React.ReactElement> = {
  card: CardSkeleton,
  list: ListSkeleton,
  text: TextSkeleton,
  chart: ChartSkeleton,
};

export default function LoadingSkeleton({ variant, count = 1 }: LoadingSkeletonProps) {
  const Skeleton = variants[variant] || TextSkeleton;
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} />
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}
