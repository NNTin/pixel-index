export function FactsRow({ facts }: { facts: string[] }) {
  return (
    <p className="m-0 flex flex-wrap gap-1.5">
      {facts.map((fact) => (
        <span key={fact} className="rounded border border-border px-2 py-0.5 text-xs text-muted">
          {fact}
        </span>
      ))}
    </p>
  );
}
