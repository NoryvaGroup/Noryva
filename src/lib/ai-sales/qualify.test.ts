import { describe, expect, it } from "vitest";
import { qualifyLead } from "./qualify";
import { customerProfileSchema, defaultProfile } from "./profile";

const CID = "00000000-0000-4000-8000-000000000001";

describe("kvalificering", () => {
  it("använder den befintliga varuautomatmodellen oförändrad", () => {
    const q = qualifyLead(
      "varuautomater",
      { onskad_automat: "Kombinerad dryck och snacks", antal_anstallda: "25–49", tidsram: "Inom 1–3 månader" },
      defaultProfile(CID, "varuautomater"),
    );
    expect(q.score).toBe(85);
    expect(q.qualification).toBe("Hög");
    expect(q.priority).toBe("HÖG");
    expect(q.source).toBe("varuautomater");
  });

  it("lämnar leads utan regler oscorade i stället för att gissa", () => {
    const q = qualifyLead("tak", { behov: "Takrenovering" }, defaultProfile(CID, "tak"));
    expect(q.source).toBe("unscored");
    expect(q.score).toBe(0);
  });

  it("scorar via kundprofilens regler utan hårdkodning", () => {
    const profile = customerProfileSchema.parse({
      customerId: CID,
      qualificationProfile: {
        builtin: "generic",
        rules: [
          { field: "tidsram", points: { "så snart som möjligt": 40 }, fallback: 5 },
          { field: "behov", points: { "byta hela taket": 35 }, fallback: 10 },
        ],
        highThreshold: 70,
        mediumThreshold: 40,
      },
    });
    const q = qualifyLead(
      "tak",
      { tidsram: "Så snart som möjligt", behov: "Byta hela taket" },
      profile,
    );
    expect(q.score).toBe(75);
    expect(q.priority).toBe("HÖG");
    expect(q.source).toBe("profile-rules");
  });
});
