import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSystemReadiness } from "@/lib/crm.functions";

function Row({ label, on, note }: { label: string; on: boolean; note: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{note}</span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs ${
            on ? "border-emerald-500/40 text-emerald-500" : "border-border text-muted-foreground"
          }`}
        >
          {on ? "PÅ" : "AV"}
        </span>
      </span>
    </li>
  );
}

/**
 * Systemstatus för AI-säljmotorn. Visar endast av/på och antal –
 * aldrig nycklar, adresser eller personuppgifter.
 */
export function ReadinessPanel() {
  const fetchReadiness = useServerFn(getSystemReadiness);
  const { data, isLoading } = useQuery({
    queryKey: ["system-readiness"],
    queryFn: () => fetchReadiness(),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Hämtar systemstatus …</p>;
  if (!data) return null;
  const f = data.flags;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Systemstatus</h2>
        <span className="rounded-full border border-amber-500/40 px-2.5 py-0.5 text-xs text-amber-500">
          Läge: {data.mode}
        </span>
      </div>
      <ul>
        <Row label="AI-utkast (generering)" on={f.enabled} note="kräver serverinställning" />
        <Row label="Granskning krävs" on={f.reviewRequired} note="hårdspärr" />
        <Row label="Automatisk sändning" on={f.autoSend} note="blockerad i kod" />
        <Row label="Svarsagent (inkorg)" on={f.replyAgentEnabled} note="endast gränssnitt" />
        <Row label="Mötesbokning" on={f.bookingAgentEnabled} note="endast gränssnitt" />
        <Row label="Extern sändning tillåten" on={data.externalSendAllowed} note="v1-spärr" />
        <Row label="Modellnyckel konfigurerad" on={data.modelKeyConfigured} note="visas ej" />
      </ul>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Kunder</dt>
          <dd className="font-medium">{data.counts.customers}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">AI påslagen för</dt>
          <dd className="font-medium">{data.counts.aiEnabledCustomers}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Utkast att granska</dt>
          <dd className="font-medium">{data.counts.runsAwaitingReview}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Åtgärder att besluta</dt>
          <dd className="font-medium">{data.counts.actionsAwaitingDecision}</dd>
        </div>
      </dl>
    </section>
  );
}
