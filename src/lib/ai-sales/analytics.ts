/**
 * Intern Noryva-analys: sammanfattar statistik per kund.
 * Rena funktioner – ingen schemaläggning, inga utskick. Saknad data
 * redovisas som null, aldrig som uppskattade eller påhittade siffror.
 */
import type { LeadOutcome } from "./v2-interfaces";

export type CustomerEvent = {
  leadId: string;
  createdAt: string;
  firstResponseAt?: string | null;
  outcome?: LeadOutcome | null;
};

export type CustomerStats = {
  customerId: string;
  leads: number;
  replied: number;
  meetings: number;
  won: number;
  lost: number;
  /** Minuter. null när data saknas. */
  medianResponseTimeMinutes: number | null;
  /** Andel 0-1. null när underlag saknas. */
  conversionRate: number | null;
  dataComplete: boolean;
};

export interface CustomerAnalyticsService {
  summarize(customerId: string, events: CustomerEvent[]): CustomerStats;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function summarizeCustomer(customerId: string, events: CustomerEvent[]): CustomerStats {
  const leads = events.length;
  const count = (o: LeadOutcome) => events.filter((e) => e.outcome === o).length;

  const responseTimes = events
    .filter((e) => e.firstResponseAt)
    .map((e) => (Date.parse(e.firstResponseAt!) - Date.parse(e.createdAt)) / 60000)
    .filter((n) => Number.isFinite(n) && n >= 0);

  const won = count("won");
  return {
    customerId,
    leads,
    replied: count("replied"),
    meetings: count("meeting"),
    won,
    lost: count("lost"),
    medianResponseTimeMinutes: median(responseTimes),
    conversionRate: leads > 0 ? won / leads : null,
    dataComplete: leads > 0 && responseTimes.length === leads,
  };
}

export const customerAnalytics: CustomerAnalyticsService = { summarize: summarizeCustomer };
