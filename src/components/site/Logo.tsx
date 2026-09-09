import noryvaLogo from "@/assets/noryva-hela-logga.png.asset.json";

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src={noryvaLogo.url}
      alt="Noryva"
      width="1983"
      height="793"
      className={`h-9 w-auto object-contain ${className ?? ""}`}
    />
  );
}
