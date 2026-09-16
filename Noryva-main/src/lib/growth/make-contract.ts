/**
 * Opt-in-kontrakt för Make-migrationen (scenario 7309535).
 *
 * `makeContext` är HELT frivilligt. Utan det beter sig `route-lead` och
 * `analyze-lead` exakt som tidigare (bakåtkompatibelt för nuvarande anropare).
 * Med det används Make-migrationens deterministiska scoringregler och
 * serversidig geografibedömning.
 *
 * Klienten får ALDRIG skicka score, route, tier, modell eller ersätta lagrade
 * svar – schemat är `strict` och innehåller enbart integrationskontext.
 */
import { z } from "zod";

export const MIGRATION_CONTRACT_VERSION = "noryva.make.migration.v1";

const prefix = z
  .string()
  .trim()
  .regex(/^\d{2,5}$/, "Postnummerprefix måste vara 2–5 siffror.");

export const makeContextSchema = z
  .object({
    /** Måste matcha lagrat lead.customer_id – annars avvisas anropet. */
    customerId: z.string().uuid(),
    serviceArea: z.string().trim().max(120).default(""),
    localPostalPrefix: prefix.optional(),
    regionalPostalPrefix: prefix.optional(),
  })
  .strict();

export type MakeContext = z.infer<typeof makeContextSchema>;

/** Kastas när makeContext.customerId inte hör ihop med lagrat lead. */
export class LeadBindingError extends Error {
  constructor(message = "makeContext.customerId matchar inte förfrågans kund.") {
    super(message);
    this.name = "LeadBindingError";
  }
}
