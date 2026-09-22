/**
 * Runtime-env för serverkod.
 *
 * På Cloudflare Workers exponeras Lovable-secrets via per-request `env`-bindingen
 * (bifogas på requesten i `src/server.ts`), inte alltid via `process.env`.
 * Den här hjälparen slår ihop båda så att t.ex. LOVABLE_API_KEY och
 * funktionsflaggorna fungerar likadant i dev, test och Worker-runtime.
 *
 * Inga värden loggas eller returneras till klienten.
 */
export type RuntimeEnv = Record<string, string | undefined>;

/** Läser Worker-bindingen från requesten och lägger den ovanpå process.env. */
export function runtimeEnvFromRequest(request?: Request): RuntimeEnv {
  const base: RuntimeEnv = typeof process !== "undefined" ? { ...process.env } : {};
  const binding = (request as Request & { env?: Record<string, unknown> })?.env;
  if (binding && typeof binding === "object") {
    for (const [key, value] of Object.entries(binding)) {
      if (typeof value === "string" && !base[key]) base[key] = value;
    }
  }
  return base;
}


/**
 * Publik bas-URL för länkar som lämnar backend. Under Vercel preview används
 * aktuell deployment-host, efter cutover kan NORYVA_PUBLIC_SITE_URL sättas
 * explicit. Faller annars tillbaka till noryva.se.
 */
export function publicSiteUrlFromEnv(env: RuntimeEnv): string {
  const explicit = (env["NORYVA_PUBLIC_SITE_URL"] ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelHost = (env["VERCEL_URL"] ?? "").trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "https://noryva.se";
}
