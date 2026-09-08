import { scoreVaruautomat } from "@/lib/landing/scoring";
import { buildAiSalesContext, serializeContext } from "@/lib/ai-sales/context";
import { applyPolicyGuardrails, fallbackOutput, needsHumanTakeover } from "@/lib/ai-sales/policy";
import { classifyReplyDeterministic } from "@/lib/ai-sales/reply";
import { runAction } from "@/lib/ai-sales/orchestrator";
import { readAiSalesFlags, assertNoExternalSend } from "@/lib/ai-sales/flags";
import { assertExecutableMode, assertStorableMode } from "@/lib/ai-sales/execution-mode";
import { verifyWebhook } from "@/lib/ai-sales/webhook-security";

const flags = readAiSalesFlags({ AI_SALES_ASSISTANT_ENABLED: "true" });
const cust = { name: "Borås Varuautomater AB", industry: "varuautomater", serviceArea: "Borås" };
const mk = (industry: string, answers: Record<string, string>) => buildAiSalesContext(
  { leadId: "L1", customerId: "C1", industry, createdAt: new Date().toISOString(), payload: { answers } }, cust as any);

const fixtures: Record<string, Record<string,string>> = {
  "VA HÖG": { onskad_automat: "Kombinerad dryck och snacks", antal_anstallda: "25–49", tidsram: "Inom 1–3 månader", befintlig_automat: "Nej", foretagsnamn: "TEST AB", kontaktperson: "Anna Andersson", epost: "anna@test.se", telefonnummer: "0700000000", postnummer: "50330", meddelande: "Ring Anna på 0700000000 eller maila anna@test.se" },
  "VA LÅG": { onskad_automat: "Vet ej", antal_anstallda: "1-9", tidsram: "Senare", foretagsnamn: "TEST AB" },
  "VA saknat": { foretagsnamn: "TEST AB" },
  "TAK NORMAL": { behov: "Takrenovering", takets_alder: "20–30 år", tidsram: "Inom 1–3 månader", projektbeskrivning: "Läckage vid skorsten. Kontakta Erik Svensson 0701234567", fullstandigt_namn: "Erik Svensson" },
};
for (const [name, a] of Object.entries(fixtures)) {
  const ind = name.startsWith("TAK") ? "tak" : "varuautomater";
  const ctx = mk(ind, a);
  const ser = serializeContext(ctx);
  const leaks = ["Anna","Andersson","anna@test.se","0700000000","Erik","Svensson","0701234567","50330"].filter(v => ser.includes(v));
  console.log(`${name}: score=${ctx.score} kval=${ctx.qualification} prio=${ctx.priority} saknas=[${ctx.missingInformation}] PII_LÄCKA=${leaks.length?JSON.stringify(leaks):"NEJ"}`);
}
console.log("VA exakt:", JSON.stringify(scoreVaruautomat({ onskad_automat:"Kombinerad dryck och snacks", antal_anstallda:"25–49", tidsram:"Inom 1–3 månader" })));

for (const t of ["Vad kostar en automat?","Kan ni ge rabatt?","Jag är mycket missnöjd med servicen","Min advokat hör av sig","Kan vi boka möte?"]) {
  const r = classifyReplyDeterministic(t);
  console.log(`reply "${t}" -> intent=${r.intent} escalate=${r.escalate} next=${r.suggestedAction}`);
}
console.log("takeover pris:", needsHumanTakeover("Vad kostar det och vilken garanti ger ni?"));
const fb = fallbackOutput(mk("varuautomater", fixtures["VA saknat"]!) as any);
console.log("fallback:", JSON.stringify(fb).slice(0,200));
const guard = applyPolicyGuardrails({ ...fb, email_draft: "Hej! Jag har nu skickat mailet och bokat ett möte kl 14. Priset är 4900 kr med 5 års garanti." } as any, mk("varuautomater", fixtures["VA HÖG"]!) as any);
console.log("guardrail draft:", JSON.stringify(guard).slice(0,400));

// kill switches
const out = await runAction({ status:"approved", executionMode:"test", subject:"S", body:"B", actionType:"send_email" } as any, flags);
console.log("mock send:", out.performed, out.mode, out.channel?.performed, out.externalEffectBlocked);
for (const [label, fn] of [["live storable", () => assertStorableMode("live")], ["live executable", () => assertExecutableMode("live")],
  ["autoSend flag", () => assertNoExternalSend(readAiSalesFlags({ AI_SALES_ASSISTANT_AUTO_SEND:"true", AI_SALES_ASSISTANT_REVIEW_REQUIRED:"false" }))],
  ["live runAction", () => runAction({ status:"approved", executionMode:"live", subject:"S", body:"B", actionType:"send_email" } as any, flags)]] as const) {
  try { await (fn as any)(); console.log(`KILLSWITCH FAIL: ${label} tilläts`); } catch (e) { console.log(`killswitch OK: ${label} -> ${(e as Error).message.slice(0,60)}`); }
}
// webhook
const secret = "s3cret"; const body = JSON.stringify({ a: 1 });
const enc = new TextEncoder();
const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
const sig = Array.from(new Uint8Array(sigBuf)).map(b=>b.toString(16).padStart(2,"0")).join("");
const seen = new Set<string>();
const o1 = await verifyWebhook({ body, signature: sig, secret, externalId: "evt1", seen } as any);
const o2 = await verifyWebhook({ body, signature: "deadbeef", secret, externalId: "evt2", seen } as any);
const o3 = await verifyWebhook({ body, signature: sig, secret, externalId: "evt1", seen } as any);
console.log("webhook giltig:", JSON.stringify(o1), "ogiltig:", JSON.stringify(o2), "replay:", JSON.stringify(o3));
