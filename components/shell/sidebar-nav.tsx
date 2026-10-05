"use client"

import Link from "next/link"
import { useMemo } from "react"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Radio, Users, KeyRound, Activity, ScrollText, Settings, ServerCog } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { useConfig } from "@/hooks/useConfig"

const items = [
  { href: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard" },
  { href: "/rooms", icon: Radio, key: "nav.rooms" },
  { href: "/users", icon: Users, key: "nav.users" },
  { href: "/tokens", icon: KeyRound, key: "nav.tokens" },
  { href: "/monitoring", icon: Activity, key: "nav.monitoring" },
  { href: "/logs", icon: ScrollText, key: "nav.logs" },
  { href: "/settings", icon: Settings, key: "nav.settings" },
] as const

export function SidebarNav({ className }: { className?: string }) {
  const pathname = usePathname()
  const { t } = useI18n()
  const { config, loading, error } = useConfig()

  const status = useMemo(() => {
    if (loading) return { connected: false, pending: true, label: t("common.loading"), detail: "..." }
    if (error) return { connected: false, pending: false, label: t("sidebar.statusUnreachable"), detail: "API error" }
    if (!config) return { connected: false, pending: false, label: t("sidebar.statusUnknown"), detail: "n/a" }
    if (!config.configured || config.connectionStatus === "not_configured") {
      return { connected: false, pending: false, label: t("sidebar.statusNotConfigured"), detail: "LIVEKIT_URL" }
    }
    if (config.connectionStatus === "error") {
      return { connected: false, pending: false, label: t("sidebar.statusUnreachable"), detail: config.url ?? "n/a" }
    }
    return {
      connected: config.connectionStatus === "connected",
      pending: false,
      label:
        config.connectionStatus === "connected"
          ? t("sidebar.statusConnected")
          : t("sidebar.statusUnknown"),
      detail: `${config.roomCount} ${t("sidebar.rooms")} \u00b7 ${config.region}`,
    }
  }, [config, loading, error, t])

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col w-64 shrink-0 border-r border-border bg-sidebar/60 backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-5 h-16 border-b border-border">
        <div className="size-8 rounded-xl bg-primary/15 grid place-items-center ring-1 ring-primary/30">
          <ServerCog className="size-4 text-primary" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">{t("app.name")}</div>
          <div className="text-[11px] text-muted-foreground">{t("app.tagline")}</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + "/")
          const Icon = it.icon
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all",
                "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent",
                active && "bg-sidebar-accent text-foreground ring-1 ring-border",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} />
              <span className="font-medium">{t(it.key)}</span>
              {active && <span className="ms-auto size-1.5 rounded-full bg-primary animate-pulse-dot" />}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="rounded-xl bg-card/60 ring-1 ring-border p-3">
          {/* Reachability comes from /api/config, which actually calls RoomService.
              A hardcoded "Cluster healthy" stayed green while the cluster was down. */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              {status.connected && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
              )}
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  status.connected ? "bg-success" : status.pending ? "bg-muted-foreground/40" : "bg-destructive",
                )}
              />
            </span>
            <span className="truncate">{status.label}</span>
          </div>
          <div className="mt-2 text-[11px] font-mono text-muted-foreground truncate" title={status.detail}>
            {status.detail}
          </div>
        </div>
      </div>
    </aside>
  )
}
