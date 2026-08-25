"use client";
import { useState, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles } from "lucide-react";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialMode = params.get("mode") === "signup" ? "signup" : "signin";
  const isSwitchMode = params.get("switch") === "1";
  const [mode, setMode] = useState<"signin" | "signup">(initialMode as any);
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me().catch(() => null),
  });
  useEffect(() => {
    if (!meLoading && (me as any)?.id && !isSwitchMode) router.replace("/");
  }, [me, meLoading, router, isSwitchMode]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Name required");
        await api.authSignUp(email, password, name.trim());
      } else {
        await api.authSignIn(email, password);
      }
      const redirect = params.get("redirect");
      if (redirect && redirect.startsWith("/")) router.replace(redirect);
      else router.push("/");
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <header className="h-14 border-b border-[var(--border)] bg-[var(--card)] px-4 flex items-center">
        <Link href="/" className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
          <span className="h-8 w-8 rounded-xl bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] text-sm font-bold shadow-[var(--shadow-soft)]">P</span> Pulse
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center p-4">
        <form onSubmit={submit} className="w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] p-6 shadow-[var(--shadow-card)] space-y-4">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <h1 className="mt-3 text-lg font-semibold text-[var(--foreground)]">{mode === "signup" ? "Create account" : "Welcome back"}</h1>
            <p className="text-sm text-[var(--muted-foreground)]">{mode === "signup" ? "Start with an account, then create a workspace." : "Sign in to your workspace."}</p>
          </div>

          <div className="flex rounded-[var(--radius-sm)] bg-[var(--muted)] p-1">
            <button type="button" onClick={() => setMode("signin")} className={`flex-1 h-7 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${mode === "signin" ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-soft)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>Sign in</button>
            <button type="button" onClick={() => setMode("signup")} className={`flex-1 h-7 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${mode === "signup" ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-soft)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>Sign up</button>
          </div>

          {mode === "signup" && (
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          <Input placeholder="email@example.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />

          {err && <div className="rounded-[var(--radius-sm)] bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300">{err.slice(0, 600)}</div>}

          <Button type="submit" disabled={loading} className="w-full">{loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}</Button>

          <div className="text-xs text-[var(--muted-foreground)] text-center">
            Secure • Petrol-mint • <span className="text-[var(--primary)]">Better-Auth</span> via Fastify
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--muted-foreground)]">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
