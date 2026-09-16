import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://noryva.se";

const paths = [
  "/",
  "/om",
  "/faq",
  "/kontakt",
  "/integritetspolicy",
  "/cookies",
  "/villkor",
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map(
    (p) =>
      `  <url><loc>${BASE_URL}${p}</loc><changefreq>monthly</changefreq><priority>${p === "/" ? "1.0" : "0.5"}</priority></url>`,
  )
  .join("\n")}
</urlset>`;
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
