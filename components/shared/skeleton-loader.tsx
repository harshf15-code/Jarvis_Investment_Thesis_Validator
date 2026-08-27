import { cn } from "@/lib/utils";

/** Amber pulsing skeleton per spec's Loading States rule — never a bare spinner on white. */
export function SkeletonLoader({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-md bg-primary/15"
          style={{ width: `${85 - i * 12}%` }}
        />
      ))}
    </div>
  );
}
