// components/feed/agenda-sidebar.tsx
export function AgendaSidebar({ agenda }: { agenda: { ticker: string; timeExitDate: string | null }[] }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-4">
      <h2 className="mb-3 font-display text-sm uppercase text-on-surface/50">Today&apos;s Agenda</h2>
      {agenda.length === 0 ? (
        <p className="text-sm text-on-surface/50">No thesis tests due in the next 14 days.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agenda.map((a) => (
            <li key={a.ticker} className="flex justify-between text-sm">
              <span className="text-on-surface">{a.ticker}</span>
              <span className="text-on-surface/60">{a.timeExitDate}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
