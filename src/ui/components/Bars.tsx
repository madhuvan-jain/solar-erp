/** Single-series horizontal bars with a direct value label; hover shows the exact value. */
export function Bars({ data, format = String, label }: { data: { name: string; value: number }[]; format?: (n: number) => string; label: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (!data.length || max <= 0) return <p className="muted">No data yet.</p>;
  return (
    <div className="bars" role="img" aria-label={label}>
      {data.map((d) => (
        <div className="bar-row" key={d.name} title={`${d.name}: ${format(d.value)}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
          <span className="track"><span className="fill" style={{ width: `${(Math.max(0, d.value) / max) * 100}%` }} /></span>
          <span className="v">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
