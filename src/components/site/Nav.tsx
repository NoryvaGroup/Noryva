import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";
import { CtaTo } from "./Button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/#sa-fungerar", label: "Så fungerar det", route: false },
  { href: "/#vad-ni-far", label: "Vad ni får", route: false },
  { href: "/om", label: "Om Noryva", route: true },
  { href: "/faq", label: "FAQ", route: true },
  { href: "/kontakt", label: "Kontakt", route: true },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const desktopClass =
    "rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const mobileClass = "block border-b border-border/60 py-4 text-base text-foreground";

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled || open
          ? "border-b border-border bg-background/85 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <nav aria-label="Huvudmeny" className="container-x flex h-[68px] items-center justify-between">
        <Link
          to="/"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              {l.route ? (
                <Link to={l.href} className={desktopClass}>
                  {l.label}
                </Link>
              ) : (
                <a href={l.href} className={desktopClass}>
                  {l.label}
                </a>
              )}
            </li>
          ))}
        </ul>

        <div className="hidden lg:block">
          <CtaTo to="/kontakt" className="px-5 py-2.5">
            Testa 30 dagar gratis <ArrowRight size={15} />
          </CtaTo>
        </div>

        <button
          type="button"
          aria-label={open ? "Stäng meny" : "Öppna meny"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-11 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface-2 lg:hidden"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {open && (
        <div className="animate-in border-t border-border bg-background duration-200 fade-in slide-in-from-top-2 lg:hidden">
          <ul className="container-x flex flex-col py-4">
            {links.map((l) => (
              <li key={l.href}>
                {l.route ? (
                  <Link to={l.href} onClick={() => setOpen(false)} className={mobileClass}>
                    {l.label}
                  </Link>
                ) : (
                  <a href={l.href} onClick={() => setOpen(false)} className={mobileClass}>
                    {l.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <div className="container-x pb-6">
            <CtaTo to="/kontakt" onClick={() => setOpen(false)} className="w-full py-4 text-base">
              Testa 30 dagar gratis <ArrowRight size={17} />
            </CtaTo>
          </div>
        </div>
      )}
    </header>
  );
}
