import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "./Logo";
import { CtaLink } from "./Button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/#tjanster", label: "Tjänster" },
  { href: "/#process", label: "Så fungerar det" },
  { href: "/#resultat", label: "Resultat" },
  { href: "/#om", label: "Om Noryva" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#kontakt", label: "Kontakt" },
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
        <a
          href="/#top"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
        </a>

        <ul className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden lg:block">
          <CtaLink href="/#kontakt" className="px-5 py-2.5">
            Boka kostnadsfri genomgång <ArrowRight size={15} />
          </CtaLink>
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
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block border-b border-border/60 py-4 text-base text-foreground"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="container-x pb-6">
            <CtaLink href="/#kontakt" onClick={() => setOpen(false)} className="w-full py-4 text-base">
              Boka kostnadsfri genomgång <ArrowRight size={17} />
            </CtaLink>
          </div>
        </div>
      )}
    </header>
  );
}
