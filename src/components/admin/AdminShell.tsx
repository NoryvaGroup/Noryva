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
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
          <Link to="/admin" className="flex items-center gap-3">
            <Logo />
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/admin" className="text-muted-foreground hover:text-foreground">
              Kunder
            </Link>
            <Link to="/admin/ai-assistent" className="text-muted-foreground hover:text-foreground">
              AI-säljassistent
            </Link>
            <button type="button" onClick={signOut} className="text-muted-foreground underline">
              Logga ut
            </button>
          </nav>

        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <h1 className="mb-8 text-2xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}
