export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-surface-container-low px-6 py-16 text-center">
      <p className="font-display text-lg text-on-surface">{title}</p>
      <p className="max-w-sm text-sm text-on-surface/60">{description}</p>
      {action}
    </div>
  );
}
