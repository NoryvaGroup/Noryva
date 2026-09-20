import { beforeEach, vi } from "vitest";
// Tests must never inherit live credentials or send unmocked network requests.
for (const key of Object.keys(process.env)) {
  if (/^(OPENAI_|SUPABASE_|VITE_SUPABASE_|LOVABLE_|NORYVA_)/.test(key)) delete process.env[key];
}
const denyNetwork: typeof fetch = async () => {
  throw new Error("Unmocked network disabled in tests");
};
globalThis.fetch = denyNetwork;
beforeEach(() => {
  vi.stubGlobal("fetch", denyNetwork);
});
