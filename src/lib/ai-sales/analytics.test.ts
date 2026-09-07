import { describe, expect, it } from "vitest";
import { summarizeCustomer } from "./analytics";

describe("kundstatistik", () => {
  it("hittar inte på siffror när data saknas", () => {
    const stats = summarizeCustomer("kund", []);
    expect(stats.leads).toBe(0);
    expect(stats.medianResponseTimeMinutes).toBeNull();
    expect(stats.conversionRate).toBeNull();
    expect(stats.dataComplete).toBe(false);
  });

  it("räknar utfall och median svarstid", () => {
    const stats = summarizeCustomer("kund", [
      { leadId: "1", createdAt: "2026-01-01T10:00:00Z", firstResponseAt: "2026-01-01T10:30:00Z", outcome: "won" },
      { leadId: "2", createdAt: "2026-01-01T10:00:00Z", firstResponseAt: "2026-01-01T11:00:00Z", outcome: "lost" },
    ]);
    expect(stats.leads).toBe(2);
    expect(stats.won).toBe(1);
    expect(stats.medianResponseTimeMinutes).toBe(45);
    expect(stats.conversionRate).toBe(0.5);
    expect(stats.dataComplete).toBe(true);
  });
});
