import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";

const nav = [
  { href: "/#tjanster", label: "Tjänster" },
  { href: "/#process", label: "Så fungerar det" },
  { href: "/#resultat", label: "Resultat" },
  { href: "/#om", label: "Om Noryva" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#kontakt", label: "Kontakt" },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="container-x grid gap-12 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Fler kvalificerade affärsmöjligheter för företag med högt kundvärde.
          </p>
        </div>

        <nav aria-label="Sidfotsmeny">
          <h2 className="text-sm font-semibold">Navigation</h2>
          <ul className="mt-4 space-y-2.5">
            {nav.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-semibold">Kontakt</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li>
              <a href="mailto:info@noryva.se" className="transition-colors hover:text-foreground">
                info@noryva.se
              </a>
            </li>
          </ul>

          <h2 className="mt-8 text-sm font-semibold">Juridiskt</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li>
              <Link to="/integritetspolicy" className="transition-colors hover:text-foreground">
                Integritetspolicy
              </Link>
            </li>
            <li>
              <Link to="/cookies" className="transition-colors hover:text-foreground">
                Cookies
              </Link>
            </li>
            <li>
              <Link to="/villkor" className="transition-colors hover:text-foreground">
                Villkor
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="container-x py-6">
          <p className="text-xs text-muted-foreground">
            © 2026 Noryva. Alla rättigheter förbehållna.
          </p>
        </div>
      </div>
    </footer>
  );
}
