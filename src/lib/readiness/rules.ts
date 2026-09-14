/**
 * Pilot readiness – rena, testbara regler.
 *
 * SÄKERHET/PRINCIP: modulen är helt READ-ONLY och gör inga anrop. Saknad eller
 * oläsbar data ger ALDRIG grönt utan blir `unknown` (fail-safe).
 */

export type CheckLevel = "ok" | "warn" | "fail" | "unknown";
export type CheckGroup = "core" | "full";

/**
 * Tidsgränser samlade på ett ställe. Ändra här – aldrig utspritt i UI eller
 * dataläsning. Alla värden i minuter.
 */
export const THRESHOLDS = {
  /** Lead som ligger kvar som pending längre än detta = varning. */
  leadPendingWarnMinutes: 30,
  /** Lead som ligger kvar som pending längre än detta = blockerande. */
  leadPendingBlockMinutes: 120,
  /** Nurture-utskick som claimats men inte skickats = fastnat. */
  nurtureClaimedStuckMinutes: 30,
  /** Påminnelse som claimats men inte skickats = fastnat. */
  reminderClaimedStuckMinutes: 30,
  /** Inkommet svar som inte slutbehandlats = fastnat. */
  inboundUnprocessedMinutes: 30,
} as const;

/** Kontroller som räknas som driftövervakning (inte ren onboarding). */
export const OPERATIONAL_CHECK_IDS = ["delivery", "nurture", "reminders", "replies", "mail"] as const;

export type ReadinessCheck = {
  id: string;
  label: string;
  group: CheckGroup;
  level: CheckLevel;
  detail: string;
  /** Exakt nästa åtgärd när kontrollen inte är grön. Tom sträng när allt är ok. */
  nextAction: string;
};

export type ReadinessStatus = "full_ready" | "core_ready" | "review" | "no_go";

export const READINESS_LABEL: Record<ReadinessStatus, string> = {
  full_ready: "FULL READY",
  core_ready: "CORE READY",
  review: "REVIEW",
  no_go: "NO-GO",
};

/** `null` i en grupp betyder "kunde inte läsas" och ger unknown, inte grönt. */
export type ReadinessFacts = {
  customer: {
    id: string;
    name: string;
    slug: string;
    status: string;
    industry: string;
    recipientEmail: string;
    deliveryWebhookUrl: string;
  };
  questions: { total: number; required: number } | null;
  profile: {
    exists: boolean;
    notifyRecipients: number;
    aiAssistantEnabled: boolean;
    executionMode: string;
  } | null;
  mailChannel: {
    configured: boolean;
    verified: boolean;
    status: string;
    senderEmail: string;
    replyToEmail: string;
    verifiedAt: string | null;
  } | null;
  leads: {
    total: number;
    pending: number;
    failed: number;
    /** Pending äldre än `leadPendingWarnMinutes`. */
    pendingOverWarn?: number;
    /** Pending äldre än `leadPendingBlockMinutes`. */
    pendingOverBlock?: number;
    latest: {
      deliveryStatus: string;
      deliveryError: string;
      deliveredAt: string | null;
      createdAt: string;
    } | null;
  } | null;
  nurture: { pending: number; approved: number; stuck: number; failed: number } | null;
  reminders: { pending: number; failed: number; stuck: number; latestStatus: string } | null;
  replies: { unprocessed: number } | null;
  contacted: { contacted: number; total: number } | null;
  /**
   * Uttryckligt launch-godkännande per kund. `null`/saknad = fail closed.
   * `published` ensamt räcker aldrig för GO.
   */
  launchApproval?: { approved: boolean; approvedAt?: string | null } | null;
};

const TEST_PATTERN = /(test|e2e|router|demo|sandbox)/i;

/** Konservativ heuristik – markerar bara, tar aldrig bort något. */
export function isTestCustomer(customer: ReadinessFacts["customer"]): boolean {
  if (customer.status !== "published") return true;
  return TEST_PATTERN.test(customer.slug) || TEST_PATTERN.test(customer.name);
}

function check(
  id: string,
  label: string,
  group: CheckGroup,
  level: CheckLevel,
  detail: string,
  nextAction: string,
): ReadinessCheck {
  return { id, label, group, level, detail, nextAction: level === "ok" ? "" : nextAction };
}

export function buildChecks(facts: ReadinessFacts): ReadinessCheck[] {
  const c = facts.customer;
  const checks: ReadinessCheck[] = [];

  // --- CORE: lead pipeline ---
  checks.push(
    check(
      "published",
      "Kundsidan är publicerad",
      "core",
      c.status === "published" ? "ok" : "fail",
      c.status === "published" ? "Publicerad" : "Utkast",
      "Publicera kundsidan i kundvyn.",
    ),
  );

  if (!facts.questions) {
    checks.push(
      check("form", "Formulär med frågor", "core", "unknown", "Kunde inte läsas", "Läs om sidan – formulärdata kunde inte hämtas."),
    );
  } else if (facts.questions.total < 1) {
    checks.push(check("form", "Formulär med frågor", "core", "fail", "0 frågor", "Lägg till minst en fråga i formuläret."));
  } else if (facts.questions.required < 1) {
    checks.push(
      check(
        "form",
        "Formulär med frågor",
        "core",
        "warn",
        `${facts.questions.total} frågor, ingen obligatorisk`,
        "Markera minst en fråga som obligatorisk.",
      ),
    );
  } else {
    checks.push(
      check(
        "form",
        "Formulär med frågor",
        "core",
        "ok",
        `${facts.questions.total} frågor, ${facts.questions.required} obligatoriska`,
        "",
      ),
    );
  }

  checks.push(
    check(
      "webhook",
      "Leveransadress (webhook)",
      "core",
      c.deliveryWebhookUrl.trim() ? "ok" : "fail",
      c.deliveryWebhookUrl.trim() ? "Angiven" : "Saknas",
      "Lägg till integrationsadressen (https) under Mottagare och leverans.",
    ),
  );

  checks.push(
    check(
      "recipient",
      "Mottagaradress",
      "core",
      c.recipientEmail.trim() ? "ok" : "fail",
      c.recipientEmail.trim() ? "Angiven" : "Saknas",
      "Lägg till mottagaradress för kundens förfrågningar.",
    ),
  );

  if (!facts.profile) {
    checks.push(check("profile", "Kundprofil", "core", "unknown", "Kunde inte läsas", "Kundprofilen kunde inte hämtas."));
    checks.push(check("notify", "Notismottagare", "core", "unknown", "Kunde inte läsas", "Kundprofilen kunde inte hämtas."));
    checks.push(check("ai", "AI-assistent påslagen", "full", "unknown", "Kunde inte läsas", "Kundprofilen kunde inte hämtas."));
    checks.push(check("mode", "Körläge", "full", "unknown", "Kunde inte läsas", "Kundprofilen kunde inte hämtas."));
  } else {
    checks.push(
      check(
        "profile",
        "Kundprofil",
        "core",
        facts.profile.exists ? "ok" : "fail",
        facts.profile.exists ? "Sparad" : "Ej sparad",
        "Spara kundprofilen under Kundprofiler.",
      ),
    );
    checks.push(
      check(
        "notify",
        "Notismottagare",
        "core",
        facts.profile.notifyRecipients > 0 ? "ok" : "fail",
        `${facts.profile.notifyRecipients} st`,
        "Lägg till minst en notismottagare i kundprofilen.",
      ),
    );
    checks.push(
      check(
        "ai",
        "AI-assistent påslagen",
        "full",
        facts.profile.aiAssistantEnabled ? "ok" : "warn",
        facts.profile.aiAssistantEnabled ? "På" : "Av",
        "Slå på AI-assistenten i kundprofilen när kunden är redo.",
      ),
    );
    const mode = facts.profile.executionMode;
    checks.push(
      check(
        "mode",
        "Körläge",
        "full",
        mode === "review" || mode === "test" ? "ok" : "warn",
        mode === "review" ? "Granskning (review)" : mode === "test" ? "Test" : mode || "okänt",
        "Sätt körläget till granskning eller test.",
      ),
    );
  }

  if (!facts.leads) {
    checks.push(
      check("delivery", "Leverans av förfrågningar", "core", "unknown", "Kunde inte läsas", "Leveransdata kunde inte hämtas."),
    );
  } else if (facts.leads.failed > 0) {
    checks.push(
      check(
        "delivery",
        "Leverans av förfrågningar",
        "core",
        "fail",
        `${facts.leads.failed} misslyckade${facts.leads.latest?.deliveryError ? ` – ${facts.leads.latest.deliveryError.slice(0, 80)}` : ""}`,
        "Åtgärda leveransfelet innan kunden går live.",
      ),
    );
  } else if ((facts.leads.pendingOverBlock ?? 0) > 0) {
    checks.push(
      check(
        "delivery",
        "Leverans av förfrågningar",
        "core",
        "fail",
        `${facts.leads.pendingOverBlock} har väntat över ${THRESHOLDS.leadPendingBlockMinutes} min`,
        "Leveransen har stannat – kontrollera integrationen innan kunden går live.",
      ),
    );
  } else if (facts.leads.pending > 0) {
    const aged = facts.leads.pendingOverWarn ?? 0;
    checks.push(
      check(
        "delivery",
        "Leverans av förfrågningar",
        "core",
        "warn",
        aged > 0
          ? `${aged} har väntat över ${THRESHOLDS.leadPendingWarnMinutes} min`
          : `${facts.leads.pending} väntar på leverans`,
        "Kontrollera att leveransflödet hinner ikapp.",
      ),
    );
  } else if (facts.leads.total === 0) {
    checks.push(
      check("delivery", "Leverans av förfrågningar", "core", "warn", "Ingen testförfrågan ännu", "Skicka en testförfrågan via kundens formulär."),
    );
  } else {
    checks.push(
      check("delivery", "Leverans av förfrågningar", "core", "ok", `${facts.leads.total} levererade`, ""),
    );
  }

  // --- FULL: mail, nurture, svar ---
  if (!facts.mailChannel) {
    checks.push(check("mail", "Mailkanal", "full", "unknown", "Kunde inte läsas", "Mailkanalens data kunde inte hämtas."));
  } else if (!facts.mailChannel.configured) {
    checks.push(check("mail", "Mailkanal", "full", "fail", "Ej konfigurerad", "Konfigurera kundens mailkanal."));
  } else if (!facts.mailChannel.verified) {
    checks.push(
      check(
        "mail",
        "Mailkanal",
        "full",
        "fail",
        `Status ${facts.mailChannel.status || "okänd"}${facts.mailChannel.senderEmail ? "" : ", avsändare saknas"}${facts.mailChannel.replyToEmail ? "" : ", svarsadress saknas"}`,
        "Verifiera kundens mailkanal.",
      ),
    );
  } else {
    checks.push(check("mail", "Mailkanal", "full", "ok", `Verifierad ${facts.mailChannel.verifiedAt?.slice(0, 10) ?? ""}`.trim(), ""));
  }

  if (!facts.nurture) {
    checks.push(check("nurture", "Nurture-kö", "full", "unknown", "Kunde inte läsas", "Nurture-data kunde inte hämtas."));
  } else if (facts.nurture.stuck > 0 || facts.nurture.failed > 0) {
    checks.push(
      check(
        "nurture",
        "Nurture-kö",
        "full",
        "fail",
        `${facts.nurture.stuck} fastnade, ${facts.nurture.failed} misslyckade`,
        "Granska fastnade nurture-utskick i Growth Engine.",
      ),
    );
  } else if (facts.nurture.pending + facts.nurture.approved > 0) {
    checks.push(
      check(
        "nurture",
        "Nurture-kö",
        "full",
        "warn",
        `${facts.nurture.pending} att granska, ${facts.nurture.approved} godkända`,
        "Granska kön så inget blir liggande.",
      ),
    );
  } else {
    checks.push(check("nurture", "Nurture-kö", "full", "ok", "Inget i kö", ""));
  }

  if (!facts.reminders) {
    checks.push(check("reminders", "Påminnelser", "full", "unknown", "Kunde inte läsas", "Påminnelsedata kunde inte hämtas."));
  } else if (facts.reminders.failed > 0 || facts.reminders.stuck > 0) {
    checks.push(
      check(
        "reminders",
        "Påminnelser",
        "full",
        "fail",
        `${facts.reminders.failed} misslyckade, ${facts.reminders.stuck} fastnade`,
        "Åtgärda påminnelser som fastnat eller misslyckats.",
      ),
    );
  } else {
    checks.push(
      check("reminders", "Påminnelser", "full", "ok", facts.reminders.latestStatus || "Inga påminnelser", ""),
    );
  }

  if (!facts.replies) {
    checks.push(check("replies", "Svarshantering", "full", "unknown", "Kunde inte läsas", "Svarshanteringens data kunde inte hämtas."));
  } else if (facts.replies.unprocessed > 0) {
    checks.push(
      check(
        "replies",
        "Svarshantering",
        "full",
        "fail",
        `${facts.replies.unprocessed} inkomna svar ej färdigbehandlade`,
        "Granska inkomna svar som inte slutförts.",
      ),
    );
  } else {
    checks.push(check("replies", "Svarshantering", "full", "ok", "Inget obehandlat", ""));
  }

  if (!facts.contacted) {
    checks.push(check("contacted", "Kontaktad-sync", "full", "unknown", "Kunde inte läsas", "Statusdata kunde inte hämtas."));
  } else {
    checks.push(
      check(
        "contacted",
        "Kontaktad-sync",
        "full",
        "ok",
        `${facts.contacted.contacted} av ${facts.contacted.total} markerade som kontaktade`,
        "",
      ),
    );
  }

  // --- CORE: uttryckligt launch-godkännande (separat gate från published) ---
  const launch = facts.launchApproval;
  if (launch === null || launch === undefined) {
    checks.push(
      check(
        "launch",
        "Launch godkänd",
        "core",
        "unknown",
        "Kunde inte läsas",
        "Launch-godkännandet kunde inte hämtas – kunden kan inte gå live.",
      ),
    );
  } else if (launch.approved !== true) {
    checks.push(
      check(
        "launch",
        "Launch godkänd",
        "core",
        "fail",
        "Ej godkänd",
        "Godkänn launch uttryckligen för kunden innan den går live.",
      ),
    );
  } else {
    checks.push(
      check("launch", "Launch godkänd", "core", "ok", `Godkänd ${launch.approvedAt?.slice(0, 10) ?? ""}`.trim(), ""),
    );
  }

  return checks;
}

export type ReadinessResult = {
  status: ReadinessStatus;
  coreReady: boolean;
  fullReady: boolean;
  checks: ReadinessCheck[];
  blocking: ReadinessCheck[];
  warnings: ReadinessCheck[];
};

export function evaluateReadiness(facts: ReadinessFacts): ReadinessResult {
  const checks = buildChecks(facts);
  const core = checks.filter((c) => c.group === "core");
  const full = checks.filter((c) => c.group === "full");

  const coreFail = core.some((c) => c.level === "fail");
  const coreUnknown = core.some((c) => c.level === "unknown");
  const fullBlocked = full.some((c) => c.level === "fail" || c.level === "unknown");
  const anyWarn = checks.some((c) => c.level === "warn");

  const coreReady = !coreFail && !coreUnknown;
  const fullReady = coreReady && !fullBlocked;

  let status: ReadinessStatus;
  if (coreFail) status = "no_go";
  else if (coreUnknown) status = "review";
  else if (fullBlocked) status = "core_ready";
  else if (anyWarn) status = "review";
  else status = "full_ready";

  return {
    status,
    coreReady,
    fullReady,
    checks,
    blocking: checks.filter((c) => c.level === "fail"),
    warnings: checks.filter((c) => c.level === "warn" || c.level === "unknown"),
  };
}

/** Onboarding-sekvensen. Varje steg mappas till en eller flera kontroller. */
export const ONBOARDING_STEPS: { key: string; label: string; checks: string[] }[] = [
  { key: "profile", label: "Kundprofil", checks: ["profile"] },
  { key: "form", label: "Formulär", checks: ["form"] },
  { key: "delivery", label: "Leverans", checks: ["webhook"] },
  { key: "recipient", label: "Mottagare", checks: ["recipient", "notify"] },
  { key: "ai", label: "AI-regler", checks: ["ai", "mode"] },
  { key: "mail", label: "Mailkanal", checks: ["mail"] },
  { key: "testlead", label: "Testlead", checks: ["delivery"] },
  { key: "golive", label: "GO-LIVE", checks: ["published"] },
];

export function stepLevel(checks: ReadinessCheck[], stepKeys: string[]): CheckLevel {
  const relevant = checks.filter((c) => stepKeys.includes(c.id));
  if (relevant.length === 0) return "unknown";
  if (relevant.some((c) => c.level === "fail")) return "fail";
  if (relevant.some((c) => c.level === "unknown")) return "unknown";
  if (relevant.some((c) => c.level === "warn")) return "warn";
  return "ok";
}

// ---------------------------------------------------------------------------
// Sammanfattningar – all härledning sker från redan beräknade kontroller.
// ---------------------------------------------------------------------------

export type GoNoGoSummary = {
  /** Sant endast när kärnflödet är helt grönt. */
  go: boolean;
  /** Blockerar CORE READY (fail eller okänt i kärnflödet). */
  coreBlockers: ReadinessCheck[];
  /** Blockerar FULL READY men inte kärnflödet. */
  fullBlockers: ReadinessCheck[];
  /** Rena varningar, blockerar inget. */
  warnings: ReadinessCheck[];
  coreReason: string;
  fullReason: string;
};

function reason(items: ReadinessCheck[], okText: string): string {
  if (items.length === 0) return okText;
  return items.map((c) => `${c.label}: ${c.detail}`).join(" · ");
}

export function summarizeGoNoGo(result: ReadinessResult): GoNoGoSummary {
  const core = result.checks.filter((c) => c.group === "core");
  const full = result.checks.filter((c) => c.group === "full");
  const coreBlockers = core.filter((c) => c.level === "fail" || c.level === "unknown");
  const fullBlockers = full.filter((c) => c.level === "fail" || c.level === "unknown");
  return {
    go: result.coreReady,
    coreBlockers,
    fullBlockers,
    warnings: result.checks.filter((c) => c.level === "warn"),
    coreReason: reason(coreBlockers, "Kärnflödet är komplett."),
    fullReason: reason(fullBlockers, "Hela automationen är komplett."),
  };
}

export type Handoff = {
  done: string[];
  remaining: string[];
  /** Exakt nästa säkra åtgärd, eller tom sträng när inget återstår. */
  nextAction: string;
  nextActionCheckId: string;
};

/** Följer onboarding-sekvensen så nästa åtgärd alltid är den tidigaste luckan. */
export function buildHandoff(result: ReadinessResult): Handoff {
  const byId = new Map(result.checks.map((c) => [c.id, c]));
  const ordered: ReadinessCheck[] = [];
  for (const step of ONBOARDING_STEPS) {
    for (const id of step.checks) {
      const c = byId.get(id);
      if (c && !ordered.includes(c)) ordered.push(c);
    }
  }
  for (const c of result.checks) if (!ordered.includes(c)) ordered.push(c);

  const done = ordered.filter((c) => c.level === "ok").map((c) => c.label);
  const open = ordered.filter((c) => c.level !== "ok");
  const next = open.find((c) => c.group === "core") ?? open[0] ?? null;

  return {
    done,
    remaining: open.map((c) => `${c.label} – ${c.detail}`),
    nextAction: next?.nextAction ?? "",
    nextActionCheckId: next?.id ?? "",
  };
}

/** Driftvarningar: bara verkliga problem, och bara i driftkontrollerna. */
export function operationalIssues(result: ReadinessResult): ReadinessCheck[] {
  const ids = OPERATIONAL_CHECK_IDS as readonly string[];
  return result.checks.filter((c) => ids.includes(c.id) && (c.level === "fail" || c.level === "unknown"));
}
