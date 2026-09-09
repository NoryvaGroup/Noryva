/**
 * Kundriktat uppföljningsutkast för nurture – REN FUNKTION, inget utskick.
 *
 * Texten är det exakta mail vi SKULLE kunna skicka senare. Den innehåller
 * aldrig priser, löften, tekniska interna ord (route, modell, score, tier)
 * eller personuppgifter. Utan verkliga frågor finns ingen preview alls.
 */

export type NurturePreview = { subject: string; body: string };

export type NurturePreviewInput = {
  questions: string[];
  /** Kundens företagsnamn – signaturen. Aldrig personnamn. */
  companyName: string;
  /** true = leadet får inte automatiskt kundutkast (HÖG/AKUT, human takeover). */
  blocked?: boolean;
};

/**
 * Returnerar null när inget utskick behövs: inga frågor, blockerat lead eller
 * saknat företagsnamn.
 */
export function buildNurturePreview(input: NurturePreviewInput): NurturePreview | null {
  if (input.blocked) return null;

  const questions = (input.questions ?? [])
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (questions.length === 0) return null;

  const company = (input.companyName ?? "").trim();
  if (!company) return null;

  const lines = [
    "Hej!",
    "",
    "Tack för din förfrågan. För att kunna återkomma med ett bra förslag behöver vi veta lite mer:",
    "",
    ...questions.map((q) => `- ${q}`),
    "",
    "Svara gärna på det här mailet så hör vi av oss.",
    "",
    "Vänliga hälsningar",
    company,
  ];

  return { subject: "Några snabba frågor om din förfrågan", body: lines.join("\n") };
}
