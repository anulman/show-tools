export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="desk-loading" role="status">
      <span>{label}</span>
      <span className="desk-loading-lines" aria-hidden="true"><span /><span /></span>
    </div>
  );
}

export function SongPending() {
  return <LoadingSkeleton label="Loading song…" />;
}
