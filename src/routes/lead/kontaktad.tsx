import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getLeadContactView, markLeadContacted } from "@/lib/lead-status.functions";

const searchSchema = z.object({
  lead: z.string().trim().default(""),
  t: z.string().trim().default(""),
});

const TITLE = "Markera förfrågan som kontaktad – Noryva";
const DESCRIPTION = "Bekräfta att du har kontaktat den här förfrågan.";

export const Route = createFileRoute("/lead/kontaktad")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ lead: search.lead, t: search.t }),
  loader: async ({ deps }) => {
    if (!deps.lead || !deps.t) return { ok: false as const, reason: "Länken är ofullständig." };
    return getLeadContactView({ data: { leadId: deps.lead, token: deps.t } });
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}

function Page() {
  const view = Route.useLoaderData();
  const search = Route.useSearch();
  const run = useServerFn(markLeadContacted);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!view.ok) {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-foreground">Länken fungerar inte</h1>
        <p className="mt-3 text-sm text-muted-foreground">{view.reason}</p>
      </Card>
    );
  }

  const already = view.status === "Kontaktad" || state === "done";

  return (
    <Card>
      <h1 className="text-xl font-semibold text-foreground">
        {already ? "Markerad som kontaktad" : "Markera denna förfrågan som kontaktad?"}
      </h1>
      {view.label ? (
        <p className="mt-2 text-sm text-muted-foreground">Förfrågan från {view.label}</p>
      ) : null}

      {already ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Tack! Förfrågan är markerad som kontaktad och du får inga fler påminnelser om den.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            Klicka på knappen när du har hört av dig till kunden.
          </p>
          <button
            type="button"
            disabled={state === "saving"}
            onClick={async () => {
              setState("saving");
              const res = await run({ data: { leadId: search.lead, token: search.t } });
              if (res.ok) {
                setState("done");
              } else {
                setState("error");
                setMessage(res.reason);
              }
            }}
            className="mt-6 w-full rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {state === "saving" ? "Sparar…" : "Markera som kontaktad"}
          </button>
          {state === "error" ? (
            <p className="mt-3 text-sm text-destructive">{message}</p>
          ) : null}
        </>
      )}
    </Card>
  );
}
