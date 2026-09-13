import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { listPilotReadiness } from "@/lib/readiness.functions";
import {
  ONBOARDING_STEPS,
  READINESS_LABEL,
  THRESHOLDS,
  stepLevel,
  type CheckLevel,
  type ReadinessCheck,
  type ReadinessStatus,
} from "@/lib/readiness/rules";

export const Route = createFileRoute("/_authenticated/admin/pilot")({
  head: () => ({
    meta: [
      { title: "Pilot readiness – Noryva" },
      { name: "description", content: "GO/NO-GO-status och onboarding-checklista per kund." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Pilot readiness – Noryva" },
      { property: "og:description", content: "GO/NO-GO-status och onboarding-checklista per kund." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PilotReadiness,
});

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  full_ready: "border-emerald-500/40 text-emerald-600",
  core_ready: "border-sky-500/40 text-sky-600",
  review: "border-amber-500/40 text-amber-600",
  no_go: "border-destructive/40 text-destructive",
};

const LEVEL_DOT: Record<CheckLevel, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  fail: "bg-destructive",
  unknown: "bg-muted-foreground",
};

const LEVEL_TEXT: Record<CheckLevel, string> = {
  ok: "Klart",
  warn: "Varning",
  fail: "Blockerar",
  unknown: "Okänt",
};

function StatusBadge({ status }: { status: ReadinessStatus }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {READINESS_LABEL[status]}
    </span>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-border/60 py-2.5 last:border-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[check.level]}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="text-sm font-medium">{check.label}</span>
        <span className="ml-2 text-xs text-muted-foreground">{check.detail}</span>
        {check.nextAction && (
          <span className="mt-1 block text-xs text-foreground/80">Nästa åtgärd: {check.nextAction}</span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">{LEVEL_TEXT[check.level]}</span>
    </li>
  );
}

function OnboardingSequence({ checks }: { checks: ReadinessCheck[] }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2">
      {ONBOARDING_STEPS.map((step, i) => {
        const level = stepLevel(checks, step.checks);
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[level]}`} aria-hidden />
              {step.label}
            </span>
            {i < ONBOARDING_STEPS.length - 1 && <span className="text-xs text-muted-foreground">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

function PilotReadiness() {
  const fetchReadiness = useServerFn(listPilotReadiness);
  const { data, isLoading, error } = useQuery({
    queryKey: ["pilot-readiness"],
    queryFn: () => fetchReadiness(),
  });
  const [showTest, setShowTest] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () => (data?.customers ?? []).filter((c) => showTest || !c.isTest),
    [data, showTest],
  );

  const alerts = useMemo(
    () =>
      (data?.customers ?? [])
        .filter((c) => showTest || !c.isTest)
        .filter((c) => c.operational.length > 0)
        .flatMap((c) =>
          c.operational.map((b) => ({ customer: c.customer.name, isTest: c.isTest, check: b })),
        ),
    [data, showTest],
  );

  return (
    <AdminShell title="Pilot readiness">
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Enbart avläsning. Inget aktiveras, skickas eller ändras härifrån – vyn visar status som den ser ut
        i databasen just nu.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Hämtar status…</p>}
      {error && (
        <p className="text-sm text-destructive">
          Statusen kunde inte hämtas just nu. Ingen slutsats dras – kontrollera igen om en stund.
        </p>
      )}

      {data && (
        <>
          <section className="mb-8 rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Driftvarningar</h2>
              <span className="text-[11px] text-muted-foreground">
                Leverans: varning efter {THRESHOLDS.leadPendingWarnMinutes} min, blockerande efter{" "}
                {THRESHOLDS.leadPendingBlockMinutes} min. Fastnat utskick efter{" "}
                {THRESHOLDS.nurtureClaimedStuckMinutes} min.
              </span>
            </div>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Inga driftproblem bland {showTest ? "visade" : "skarpa"} kunder.
              </p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[a.check.level]}`} aria-hidden />
                    <span className="font-medium">{a.customer}</span>
                    {a.isTest && <span className="text-[11px] text-muted-foreground">(testdata)</span>}
                    <span className="text-muted-foreground">
                      {a.check.label} – {a.check.detail}:
                    </span>
                    <span>{a.check.nextAction}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Uppdaterad {new Date(data.generatedAt).toLocaleString("sv-SE")}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
              Visa testdata
            </label>
          </div>

          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Inga skarpa kunder att visa. Slå på "Visa testdata" för utkast och testkunder.
            </p>
          )}

          <ul className="space-y-3">
            {rows.map((row) => {
              const open = openId === row.customer.id;
              return (
                <li key={row.customer.id} className="rounded-2xl border border-border bg-surface-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.customer.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left"
                  >
                    <span>
                      <span className="font-semibold">{row.customer.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">/offert/{row.customer.slug}</span>
                      {row.isTest && (
                        <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          testdata
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {row.executionMode && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          läge: {row.executionMode}
                        </span>
                      )}
                      <StatusBadge status={row.status} />
                      <span className="text-xs text-muted-foreground">{open ? "Dölj" : "Visa"}</span>
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-border px-5 py-4">
                      <OnboardingSequence checks={row.checks} />
                      <ul>
                        {row.checks.map((check) => (
                          <CheckRow key={check.id} check={check} />
                        ))}
                      </ul>
                      <Link
                        to="/admin/$customerId"
                        params={{ customerId: row.customer.id }}
                        className="mt-4 inline-block rounded-full border border-border px-4 py-2 text-sm"
                      >
                        Öppna kundvyn
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </AdminShell>
  );
}
