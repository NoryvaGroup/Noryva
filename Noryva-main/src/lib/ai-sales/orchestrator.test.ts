import { describe, expect, it } from "vitest";
import { runAction } from "./orchestrator";
import { createMockChannels } from "./channels";
import { readAiSalesFlags } from "./flags";

const flags = readAiSalesFlags({ AI_SALES_ASSISTANT_ENABLED: "true" });

const base = {
  status: "approved" as const,
  executionMode: "test" as const,
  subject: "Uppföljning",
  body: "Hej, här är nästa steg.",
};

describe("orkestrerare", () => {
  it("kör mailåtgärd via mockad kanal utan extern effekt", async () => {
    const out = await runAction({ ...base, actionType: "send_email" }, flags);
    expect(out.performed).toBe(false);
    expect(out.mode).toBe("mock");
    expect(out.channel?.channel).toBe("email");
    expect(out.channel?.performed).toBe(false);
    expect(out.externalEffectBlocked).toBe(true);
  });

  it("kör mötesbokning mot mockad kalender", async () => {
    const out = await runAction(
      { ...base, actionType: "book_meeting", meetingMinutes: 45, meetingSlot: "2026-02-01T09:00:00Z" },
      flags,
    );
    expect(out.channel?.channel).toBe("calendar");
    expect(out.channel?.wouldHaveDone).toContain("45 minuter");
  });

  it("blockerar skarpt läge", async () => {
    await expect(
      runAction({ ...base, actionType: "send_email", executionMode: "live" as never }, flags),
    ).rejects.toThrow();
  });

  it("kräver godkänd status", async () => {
    await expect(
      runAction({ ...base, status: "draft" as never, actionType: "send_email" }, flags),
    ).rejects.toThrow();
  });

  it("har ingen kanal för interna åtgärder", async () => {
    const out = await runAction({ ...base, actionType: "handoff_to_human" }, flags);
    expect(out.channel).toBeNull();
  });

  it("mockad inkorg och kalender gör inga anrop", async () => {
    const channels = createMockChannels();
    expect(await channels.inbox.poll("test")).toEqual([]);
    expect(await channels.calendar.proposeSlots("lead:1", "test")).toEqual([]);
  });
});
