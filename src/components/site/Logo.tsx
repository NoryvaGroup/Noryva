export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="text-primary"
        fill="none"
      >
        <path
          d="M4 19V5l16 14V5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-display text-[1.05rem] font-semibold tracking-tight text-foreground">
        Noryva
      </span>
    </span>
  );
}
