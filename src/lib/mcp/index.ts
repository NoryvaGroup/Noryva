import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getCompanyInfo from "./tools/get-company-info";
import listServices from "./tools/list-services";
import getProcess from "./tools/get-process";
import searchFaq from "./tools/search-faq";
import checkFit from "./tools/check-fit";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string;

export default defineMcp({
  name: "noryva-growth-engine",
  title: "Noryva Growth Engine",
  version: "0.1.0",
  instructions:
    "Publika verktyg för Noryva – en svensk digital tillväxtbyrå. Använd get_company_info för kontakt och översikt, list_services för tjänster, get_process för arbetssättet, search_faq för vanliga frågor och check_fit för att se om en bransch tillhör målgruppen. Allt innehåll är samma publika information som finns på noryva.se.",
  // MCP-servern kräver inloggning: endast klienter med giltig OAuth-token från
  // projektets egen inloggning får anropa verktygen.
  auth: auth.oauth.issuer({
    issuer: `${supabaseUrl}/auth/v1`,
    acceptedAudiences: ["authenticated"],
    resourceName: "Noryva Growth Engine",
  }),
  tools: [getCompanyInfo, listServices, getProcess, searchFaq, checkFit],
});
