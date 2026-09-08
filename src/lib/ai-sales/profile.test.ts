import { describe, expect, it } from "vitest";
import {
  customerProfileSchema,
  defaultProfile,
  profileToRow,
  rowToProfile,
} from "./profile";

const CUSTOMER = "802728cd-acc5-49df-ad8b-3ec473006086";

describe("customer profile", () => {
  it("ger säkra defaults per bransch", () => {
    const p = defaultProfile(CUSTOMER, "varuautomater");
    expect(p.qualificationProfile.builtin).toBe("varuautomater");
    expect(p.aiAssistantEnabled).toBe(false);
    expect(p.bookingRules.enabled).toBe(false);
    expect(p.followupRules.maxFollowups).toBe(2);
  });

  it("faller tillbaka på generisk profil för okänd bransch", () => {
    expect(defaultProfile(CUSTOMER, "tak").qualificationProfile.builtin).toBe("generic");
  });

  it("avvisar ogiltiga värden", () => {
    expect(
      customerProfileSchema.safeParse({ ...defaultProfile(CUSTOMER, "tak"), customerId: "nej" })
        .success,
    ).toBe(false);
    expect(
      customerProfileSchema.safeParse({
        ...defaultProfile(CUSTOMER, "tak"),
        followupRules: { firstFollowupHours: { HÖG: 1, NORMAL: 2, LÅG: 3 }, maxFollowups: 50 },
      }).success,
    ).toBe(false);
  });

  it("roundtrippar mellan rad och profil", () => {
    const p = defaultProfile(CUSTOMER, "varuautomater");
    expect(rowToProfile(profileToRow(p))).toEqual(p);
  });

  it("hanterar tomma jsonb-fält från databasen", () => {
    const p = rowToProfile({
      customer_id: CUSTOMER,
      qualification_profile: {},
      followup_rules: {},
      booking_rules: {},
      notify_recipients: null,
    });
    expect(p.tone).toBe("professionell");
    expect(p.language).toBe("sv");
    expect(p.notifyRecipients).toEqual([]);
  });
});
