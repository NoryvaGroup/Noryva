export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <img
        src="/noryva-mark-96.png"
        alt=""
        aria-hidden="true"
        width="28"
        height="28"
        className="size-7 shrink-0 object-contain"
      />
      <span className="font-display text-[1.05rem] font-semibold text-foreground">
        Noryva
      </span>
    </span>
  );
}
