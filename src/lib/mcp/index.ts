import { defineMcp } from "@lovable.dev/mcp-js";
import getCompanyInfo from "./tools/get-company-info";
import listServices from "./tools/list-services";
import getProcess from "./tools/get-process";
import searchFaq from "./tools/search-faq";
import checkFit from "./tools/check-fit";

export default defineMcp({
  name: "noryva-growth-engine",
  title: "Noryva Growth Engine",
  version: "0.1.0",
  instructions:
    "Publika verktyg för Noryva – en svensk digital tillväxtbyrå. Använd get_company_info för kontakt och översikt, list_services för tjänster, get_process för arbetssättet, search_faq för vanliga frågor och check_fit för att se om en bransch tillhör målgruppen. Allt innehåll är samma publika information som finns på noryva.se.",
  tools: [getCompanyInfo, listServices, getProcess, searchFaq, checkFit],
});
