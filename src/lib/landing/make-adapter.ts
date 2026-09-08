import type { PublicQuestion } from "./schema";
import type { Industry } from "./templates";

/**
 * Fältnycklar som Make-flödet känner igen idag. Adaptern översätter
 * branschspecifika svar till exakt dessa nycklar.
 */
export type MakeLeadFields = {
  behov: string;
  takets_alder: string;
  ager_fastigheten: string;
  planerad_tidpunkt: string;
  projektbeskrivning: string;
  postnummer: string;
  fullstandigt_namn: string;
  telefonnummer: string;
  epost: string;
  samtycke: boolean;
};

/**
 * Sparad payload: de ursprungliga dynamiska svaren behålls strukturerat
 * separat från de normaliserade Make-fälten.
 */
export type StoredLeadPayload = {
  payload_version: 2;
  answers: Record<string, string>;
  make: MakeLeadFields;
};

export function buildStoredPayload(
  answers: Record<string, string>,
  make: MakeLeadFields,
): StoredLeadPayload {
  return { payload_version: 2, answers, make };
}

/**
 * Läser en sparad payload. Hanterar både nya poster (svar + Make-fält)
 * och äldre poster som bara innehåller platta Make-fält.
 */
export function readStoredPayload(payload: unknown): {
  answers: Record<string, string> | null;
  make: MakeLeadFields | null;
} {
  if (!payload || typeof payload !== "object") return { answers: null, make: null };
  const p = payload as Record<string, unknown>;

  if (p["payload_version"] === 2 || (p["make"] && typeof p["make"] === "object")) {
    const answers =
      p["answers"] && typeof p["answers"] === "object"
        ? (p["answers"] as Record<string, string>)
        : null;
    return { answers, make: (p["make"] as MakeLeadFields) ?? null };
  }

  // Poster som bara innehåller råsvar (t.ex. testfixturer eller tidiga leads).
  if (p["answers"] && typeof p["answers"] === "object") {
    return { answers: p["answers"] as Record<string, string>, make: null };
  }

  // Äldre lead: platta Make-fält utan sparade råsvar.
  if ("behov" in p || "fullstandigt_namn" in p) {
    return { answers: null, make: p as unknown as MakeLeadFields };
  }
  return { answers: null, make: null };

}

const get = (values: Record<string, string>, key: string) => (values[key] ?? "").trim();

/** Etiketterad sammanställning av samtliga frågor och svar. */
function labelledAnswers(questions: PublicQuestion[], values: Record<string, string>): string[] {
  return questions
    .map((q) => {
      const v = get(values, q.field_key);
      return v ? `${q.label}: ${v}` : "";
    })
    .filter(Boolean);
}

/**
 * Ren funktion: bygger de Make-kompatibla fälten utifrån bransch,
 * kundens frågor och de validerade svaren. Innehåller aldrig
 * servermetadata (kund_id, source, tidsstämpel, mottagare).
 */
export function buildMakeFields(input: {
  industry: Industry | string;
  questions: PublicQuestion[];
  values: Record<string, string>;
}): MakeLeadFields {
  const { questions, values } = input;

  if (input.industry === "varuautomater") {
    const automat = get(values, "onskad_automat");
    const antal = get(values, "antal_anstallda");
    const befintlig = get(values, "befintlig_automat") || "Okänt";

    const behov = `Varuautomat: ${automat || "Ej angivet"}. Antal anställda: ${
      antal || "Ej angivet"
    }. Befintlig automat: ${befintlig}.`;

    const projektbeskrivning = labelledAnswers(questions, values).join("\n");


    return {
      behov,
      takets_alder: "",
      ager_fastigheten: "",
      planerad_tidpunkt: get(values, "tidsram"),
      projektbeskrivning,
      postnummer: get(values, "postnummer"),
      fullstandigt_namn: get(values, "kontaktperson"),
      telefonnummer: get(values, "telefonnummer"),
      epost: get(values, "epost"),
      samtycke: true,
    };
  }

  // Tak (och övriga branscher): behåll ursprungliga fältnycklar.
  return {
    behov: get(values, "behov"),
    takets_alder: get(values, "takets_alder"),
    ager_fastigheten: get(values, "ager_fastigheten"),
    planerad_tidpunkt: get(values, "planerad_tidpunkt"),
    projektbeskrivning: get(values, "projektbeskrivning"),
    postnummer: get(values, "postnummer"),
    fullstandigt_namn: get(values, "fullstandigt_namn"),
    telefonnummer: get(values, "telefonnummer"),
    epost: get(values, "epost"),
    samtycke: true,
  };
}
