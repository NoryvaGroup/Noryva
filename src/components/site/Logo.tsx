export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className ?? ""}`}
      aria-label="Noryva"
    >
      <img
        src="/noryva-mark-96.png"
        alt=""
        width="36"
        height="36"
        className="h-9 w-9 shrink-0 object-contain"
      />
      <span className="text-[1.35rem] font-semibold tracking-[-0.035em] text-foreground">
        Noryva
      </span>
    </span>
  );
}
