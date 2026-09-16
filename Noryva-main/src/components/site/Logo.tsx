import noryvaLogo from "@/assets/noryva-hela-logga.png.asset.json";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`relative inline-block h-9 w-[90px] ${className ?? ""}`}>
      <img
        src={noryvaLogo.url}
        alt="Noryva"
        width="1983"
        height="793"
        className="absolute inset-0 size-full object-contain"
      />
    </span>
  );
}
