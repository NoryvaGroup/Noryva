import { createFileRoute, notFound } from "@tanstack/react-router";
import { DynamicLanding } from "@/components/landing/dynamic/DynamicLanding";
import { getPublicLanding } from "@/lib/public-landing.functions";

export const Route = createFileRoute("/offert/$slug")({
  loader: async ({ params }) => {
    const { landing } = await getPublicLanding({ data: { slug: params.slug } });
    if (!landing) throw notFound();
    return { landing };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.landing.headline || loaderData?.landing.name || "Offertförfrågan";
    const description =
      loaderData?.landing.description || "Skicka en kostnadsfri förfrågan på under en minut.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: "noindex, nofollow" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "theme-color", content: "#f7f7f5" },
      ],
    };
  },
  errorComponent: () => (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground">Sidan kunde inte laddas just nu.</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground">Sidan finns inte eller är inte publicerad.</p>
    </div>
  ),
  component: Page,
});

function Page() {
  const { landing } = Route.useLoaderData();
  return <DynamicLanding landing={landing} />;
}
