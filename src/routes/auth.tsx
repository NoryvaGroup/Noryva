import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Logga in – Noryva" },
      { name: "description", content: "Inloggning till Noryvas interna kundpanel." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Logga in – Noryva" },
      { property: "og:description", content: "Inloggning till Noryvas interna kundpanel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const res =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/admin` },
          });
    setBusy(false);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    if (mode === "up" && !res.data.session) {
      setMessage("Kontot är skapat. Bekräfta din e-post och logga sedan in.");
      return;
    }
    navigate({ to: "/admin", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Noryva kundpanel</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Endast för Noryvas eget team. Behörighet tilldelas manuellt.
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              E-post
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-base"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Lösenord
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-base"
            />
          </div>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Vänta…" : mode === "in" ? "Logga in" : "Skapa konto"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-5 text-sm text-muted-foreground underline"
        >
          {mode === "in" ? "Skapa konto" : "Jag har redan ett konto"}
        </button>
      </div>
    </div>
  );
}
