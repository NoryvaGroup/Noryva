/**
 * Körläge per kund.
 *
 * HÅRDSPÄRR: "live" existerar som begrepp i typerna (UI får visa det som
 * framtida läge) men kan aldrig sättas eller köras i den här versionen.
 * Spärren finns på tre nivåer: schemat nedan, assert-funktionerna här och
 * ett CHECK-villkor i databasen (customer_profiles_execution_mode_chk).
 */
import { z } from "zod";

/** Lägen som går att spara. Live saknas medvetet. */
export const storableExecutionModeSchema = z.enum(["test", "review"]);
export type StorableExecutionMode = z.infer<typeof storableExecutionModeSchema>;

/** Alla lägen som finns i domänen, inklusive det framtida. */
export const executionModeSchema = z.enum(["test", "review", "live"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  test: "Testläge (inget lämnar systemet)",
  review: "Granskningsläge (kräver godkännande)",
  live: "Skarpt läge (ej tillgängligt)",
};

/** Live kan aldrig aktiveras i den här fasen. */
export const LIVE_MODE_AVAILABLE = false;

export function isLiveMode(mode: string): boolean {
  return mode === "live";
}

/** Normaliserar ett okänt värde från databasen till ett tillåtet läge. */
export function readExecutionMode(value: unknown): StorableExecutionMode {
  const parsed = storableExecutionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "test";
}

/**
 * Validerar ett läge som någon försöker spara. Live avvisas alltid,
 * oavsett vad klienten skickar.
 */
export function assertStorableMode(value: unknown): StorableExecutionMode {
  if (isLiveMode(String(value))) {
    throw new Error("Skarpt läge kan inte aktiveras i den här versionen.");
  }
  const parsed = storableExecutionModeSchema.safeParse(value);
  if (!parsed.success) throw new Error("Ogiltigt körläge.");
  return parsed.data;
}

/** Kontroll precis innan en åtgärd körs. Kastar om skarpt läge begärs. */
export function assertExecutableMode(mode: string): StorableExecutionMode {
  if (isLiveMode(mode) || LIVE_MODE_AVAILABLE) {
    throw new Error("Skarpt läge är blockerat server-side. Endast test/granskning körs.");
  }
  return assertStorableMode(mode);
}
