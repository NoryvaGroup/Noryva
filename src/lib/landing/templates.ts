export type Industry = "tak" | "varuautomater";

export type QuestionType = "text" | "textarea" | "select" | "email" | "tel";

export type QuestionDraft = {
  field_key: string;
  label: string;
  field_type: QuestionType;
  options: string[];
  required: boolean;
  sort_order: number;
};

export type IndustryTemplate = {
  id: Industry;
  label: string;
  schema_version: number;
  headline: string;
  description: string;
  cta_label: string;
  questions: QuestionDraft[];
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: "Kort text",
  textarea: "Längre text",
  select: "Flervalslista",
  email: "E-post",
  tel: "Telefon",
};

const roof: IndustryTemplate = {
  id: "tak",
  label: "Tak",
  schema_version: 1,
  headline: "Få en kostnadsfri bedömning av ditt tak",
  description:
    "Beskriv ditt tak på under en minut så återkommer vi med nästa steg. Inga förpliktelser.",
  cta_label: "Skicka förfrågan",
  questions: [
    {
      field_key: "behov",
      label: "Vad behöver du hjälp med?",
      field_type: "select",
      options: ["Takbyte", "Takrenovering", "Takreparation", "Takbesiktning", "Annat"],
      required: true,
      sort_order: 0,
    },
    {
      field_key: "takets_alder",
      label: "Hur gammalt är taket?",
      field_type: "select",
      options: ["Under 10 år", "10–20 år", "20–30 år", "Över 30 år", "Vet inte"],
      required: true,
      sort_order: 1,
    },
    {
      field_key: "planerad_tidpunkt",
      label: "När vill du genomföra projektet?",
      field_type: "select",
      options: ["Så snart som möjligt", "Inom 1–3 månader", "Inom 3–6 månader", "Senare", "Vet inte"],
      required: true,
      sort_order: 2,
    },
    {
      field_key: "postnummer",
      label: "Postnummer",
      field_type: "text",
      options: [],
      required: true,
      sort_order: 3,
    },
    {
      field_key: "fullstandigt_namn",
      label: "För- och efternamn",
      field_type: "text",
      options: [],
      required: true,
      sort_order: 4,
    },
    {
      field_key: "telefonnummer",
      label: "Telefonnummer",
      field_type: "tel",
      options: [],
      required: true,
      sort_order: 5,
    },
    { field_key: "epost", label: "E-post", field_type: "email", options: [], required: true, sort_order: 6 },
    {
      field_key: "projektbeskrivning",
      label: "Vill du beskriva projektet? (frivilligt)",
      field_type: "textarea",
      options: [],
      required: false,
      sort_order: 7,
    },
  ],
};

const vending: IndustryTemplate = {
  id: "varuautomater",
  label: "Varuautomater",
  schema_version: 1,
  headline: "Intresseanmälan för varuautomat på arbetsplatsen",
  description:
    "Berätta kort om er arbetsplats så återkommer vi med förslag och villkor. Inget avtal skapas via formuläret.",
  cta_label: "Skicka förfrågan",
  questions: [
    {
      field_key: "foretagsnamn",
      label: "Företagsnamn",
      field_type: "text",
      options: [],
      required: true,
      sort_order: 0,
    },
    {
      field_key: "kontaktperson",
      label: "Kontaktperson",
      field_type: "text",
      options: [],
      required: true,
      sort_order: 1,
    },
    { field_key: "epost", label: "E-post", field_type: "email", options: [], required: true, sort_order: 2 },
    {
      field_key: "telefonnummer",
      label: "Telefonnummer",
      field_type: "tel",
      options: [],
      required: true,
      sort_order: 3,
    },
    { field_key: "ort", label: "Ort", field_type: "text", options: [], required: true, sort_order: 4 },
    {
      field_key: "postnummer",
      label: "Postnummer",
      field_type: "text",
      options: [],
      required: true,
      sort_order: 5,
    },
    {
      field_key: "antal_anstallda",
      label: "Antal anställda på platsen",
      field_type: "select",
      options: ["1–9", "10–24", "25–49", "50–99", "100+"],
      required: true,
      sort_order: 6,
    },
    {
      field_key: "onskad_automat",
      label: "Vilken typ av automat är ni intresserade av?",
      field_type: "select",
      options: ["Dryck", "Snacks", "Kombinerad dryck och snacks", "Kaffe", "Vet inte ännu"],
      required: true,
      sort_order: 7,
    },
    {
      field_key: "befintlig_automat",
      label: "Har ni redan en varuautomat?",
      field_type: "select",
      options: ["Nej", "Ja, vill byta eller komplettera", "Ja, vill jämföra alternativ", "Vet inte"],
      required: false,
      sort_order: 8,
    },
    {
      field_key: "tidsram",
      label: "När vill ni komma igång?",
      field_type: "select",
      options: ["Så snart som möjligt", "Inom 1–3 månader", "Inom 3–6 månader", "Senare", "Vet inte"],
      required: true,
      sort_order: 9,
    },
    {
      field_key: "meddelande",
      label: "Övrig information (frivilligt)",
      field_type: "textarea",
      options: [],
      required: false,
      sort_order: 10,
    },
  ],
};

export const INDUSTRY_TEMPLATES: Record<Industry, IndustryTemplate> = {
  tak: roof,
  varuautomater: vending,
};

export const INDUSTRY_OPTIONS: { value: Industry; label: string }[] = [
  { value: "tak", label: "Tak" },
  { value: "varuautomater", label: "Varuautomater" },
];
