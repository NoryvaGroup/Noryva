import { describe, expect, it } from "vitest";
import {
  assertExecutableMode,
  assertStorableMode,
  LIVE_MODE_AVAILABLE,
  readExecutionMode,
} from "./execution-mode";

describe("körläge per kund", () => {
  it("har skarpt läge hårdspärrat", () => {
    expect(LIVE_MODE_AVAILABLE).toBe(false);
    expect(() => assertStorableMode("live")).toThrow(/Skarpt läge/);
    expect(() => assertExecutableMode("live")).toThrow();
  });

  it("tillåter test och granskning", () => {
    expect(assertStorableMode("test")).toBe("test");
    expect(assertExecutableMode("review")).toBe("review");
  });

  it("faller tillbaka till testläge vid okänt värde", () => {
    expect(readExecutionMode("live")).toBe("test");
    expect(readExecutionMode(undefined)).toBe("test");
    expect(readExecutionMode("review")).toBe("review");
  });
});
