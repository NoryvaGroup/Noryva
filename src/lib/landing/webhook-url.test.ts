import { describe, expect, it } from "vitest";
import { isSafeDeliveryUrl } from "./webhook-url";
import { TEST_WEBHOOK_URL } from "../public-landing.functions";

describe("isSafeDeliveryUrl", () => {
  it("tillåter externa https-adresser", () => {
    expect(isSafeDeliveryUrl("https://hook.eu1.make.com/abc123")).toBe(true);
    expect(isSafeDeliveryUrl(TEST_WEBHOOK_URL)).toBe(true);
  });

  it("avvisar http, tomt och skräp", () => {
    expect(isSafeDeliveryUrl("http://hook.eu1.make.com/abc")).toBe(false);
    expect(isSafeDeliveryUrl("")).toBe(false);
    expect(isSafeDeliveryUrl(null)).toBe(false);
    expect(isSafeDeliveryUrl("inte-en-url")).toBe(false);
    expect(isSafeDeliveryUrl("file:///etc/passwd")).toBe(false);
  });

  it("avvisar interna och privata adresser", () => {
    for (const url of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://172.16.4.1/hook",
      "https://192.168.1.10/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.google.internal/x",
      "https://[::1]/hook",
    ]) {
      expect(isSafeDeliveryUrl(url), url).toBe(false);
    }
  });
});
