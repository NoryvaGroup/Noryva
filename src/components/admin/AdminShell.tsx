import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/site/Logo";

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen min-w-0 overflow-x-clip bg-background text-foreground">
      <header className="min-w-0 border-b border-border">
        <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-4 py-4 sm:gap-8 sm:px-6 lg:px-8">

          <Link to="/admin" className="flex shrink-0 items-center gap-3">
            <Logo />
          </Link>
          <nav className="flex min-w-0 items-center gap-5 overflow-x-auto whitespace-nowrap text-sm">
            <Link to="/admin" className="text-muted-foreground hover:text-foreground">
              Kunder
            </Link>
            <Link to="/admin/pilot" className="text-muted-foreground hover:text-foreground">
              Pilot readiness
            </Link>

            <Link to="/admin/crm" className="text-muted-foreground hover:text-foreground">
              Lead-CRM
            </Link>
            <Link to="/admin/profiler" className="text-muted-foreground hover:text-foreground">
              Kundprofiler
            </Link>
            <Link to="/admin/konversationer" className="text-muted-foreground hover:text-foreground">
              Konversationer
            </Link>
            <Link to="/admin/ai-assistent" className="text-muted-foreground hover:text-foreground">
              AI-säljassistent
            </Link>
            <Link to="/admin/growth" className="text-muted-foreground hover:text-foreground">
              Growth Engine
            </Link>
            <Link to="/admin/agents" className="text-muted-foreground hover:text-foreground">
              Agent HQ
            </Link>

            <button type="button" onClick={signOut} className="text-muted-foreground underline">
              Logga ut
            </button>
          </nav>

        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="mb-8 text-2xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}
