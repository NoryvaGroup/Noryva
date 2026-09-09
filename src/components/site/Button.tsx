import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:pointer-events-none";

const styles = {
  primary:
    "bg-primary text-primary-foreground px-6 py-3 hover:brightness-110 hover:-translate-y-0.5 shadow-[var(--glow-accent)]",
  ghost:
    "border border-border bg-transparent text-foreground px-6 py-3 hover:bg-surface-2 hover:-translate-y-0.5",
  quiet: "text-muted-foreground px-3 py-2 hover:text-foreground",
} as const;

type Variant = keyof typeof styles;

export function CtaLink({
  variant = "primary",
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={cn(base, styles[variant], className)} {...props} />;
}

/** Intern navigering med samma knappstil som CtaLink. */
export function CtaTo({
  to,
  variant = "primary",
  className,
  children,
  onClick,
}: {
  to: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(base, styles[variant], className)}
    >
      {children}
    </Link>
  );
}

export function CtaButton({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={cn(base, styles[variant], className)} {...props} />;
}
