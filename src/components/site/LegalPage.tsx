import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="pt-32 pb-20 sm:pt-40">
        <article className="container-x max-w-3xl">
          <h1 className="text-3xl font-semibold sm:text-5xl">{title}</h1>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">{intro}</p>
          <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground sm:text-base [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mt-2 [&_p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
