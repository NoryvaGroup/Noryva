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

    const foretag = get(values, "foretagsnamn");
    const ort = get(values, "ort");
    const projektbeskrivning = [
      foretag ? `Företagsnamn: ${foretag}` : "",
      ort ? `Ort: ${ort}` : "",
      ...labelledAnswers(questions, values),
    ]
      .filter(Boolean)
      .join("\n");

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
