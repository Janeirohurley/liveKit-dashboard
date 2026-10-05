"use client"

import { useState } from "react"
import Link from "next/link"
import { ServerCog, ArrowRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useI18n } from "@/lib/i18n"

export default function LoginPage() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    const remember = form.get("remember") === "on"

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(
          data.error === "invalid_credentials"
            ? t("auth.invalidCredentials")
            : t("auth.loginFailed"),
        )
        return
      }

      // The session cookie is HttpOnly, so a hard navigation is what lets the
      // server component in app/(app)/layout.tsx see it on the first render.
      window.location.assign("/dashboard")
    } catch {
      setError(t("auth.loginFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Visual side */}
      <div className="hidden lg:flex relative overflow-hidden bg-sidebar border-r border-border">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
        <div className="relative z-10 flex flex-col justify-between p-10 w-full">
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-xl bg-primary/15 grid place-items-center ring-1 ring-primary/30">
              <ServerCog className="size-5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t("app.name")}</div>
              <div className="text-[11px] text-muted-foreground">{t("app.tagline")}</div>
            </div>
          </div>

          <div className="space-y-4 max-w-md">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">
              The control plane for your <span className="text-primary">realtime</span> infrastructure.
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Inspect rooms, mint signed JWTs, stream logs, and watch every WebRTC transport across your fleet — from a single, fast operator console.
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Self-hosted. Your credentials never leave this deployment.
          </div>
        </div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("auth.welcome")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("auth.subtitle")}</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input id="email" name="email" type="email" autoComplete="username" placeholder="admin@livekit.local" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="remember" name="remember" defaultChecked />
              <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground cursor-pointer">
                {t("auth.remember")}
                <span className="ms-1 text-muted-foreground">({t("auth.rememberHint")})</span>
              </Label>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : (
                <>
                  {t("auth.signin")} <ArrowRight className="size-4" />
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">{t("auth.noAccount")}</p>
          </form>

          <p className="text-xs text-muted-foreground text-center">
            <Link href="/" className="hover:text-foreground hover:underline">
              {t("common.backToHome")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
