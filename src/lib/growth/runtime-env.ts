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
