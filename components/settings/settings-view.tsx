"use client"

import { useState } from "react"
import {
  ServerCog,
  RefreshCw,
  RotateCw,
  Heart,
  Webhook,
  Copy,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  Database,
  Activity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { useConfig } from "@/hooks/useConfig"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/**
 * Deployment inventory, not a configuration editor.
 *
 * This dashboard cannot write LiveKit's configuration — the server owns it, and
 * changing it means restarting it. An earlier version of this page presented
 * editable fields and toggles pre-filled with invented values (`Cluster name:
 * livekit-prod-eu`, `TURN host: turn.example.com`, a `••••••••` shared secret,
 * `Allowed origins: https://app.example.com`, an `Enable recording` switch) and
 * a `Save changes` button that only fired a toast. Every one of those was a lie
 * about a system the page had no access to, and the toggles looked like security
 * controls.
 *
 * So: read-only values read from `/api/config` and `/api/health`, and for
 * anything the dashboard does not know, it says so instead of guessing.
 */
export function SettingsView() {
  const { t } = useI18n()
  const { config, loading, error, refetch } = useConfig()
  const [testing, setTesting] = useState(false)

  async function testConnection() {
    setTesting(true)
    try {
      await refetch()
      const status = config?.connectionStatus
      if (status === "connected") {
        toast.success(t("settings.testConnected", { rooms: config?.roomCount ?? 0 }))
      } else if (status === "error") {
        toast.error(`${t("settings.testFailed")}: ${config?.error ?? "unknown error"}`)
      } else {
        toast.error(t("settings.testNotConfigured"))
      }
    } catch {
      toast.error(t("settings.testFailed"))
    } finally {
      setTesting(false)
    }
  }

  const status = config?.connectionStatus ?? "unknown"
  const statusInfo = {
    connected: {
      icon: CheckCircle2,
      color: "text-success",
      bg: "bg-success/10",
      ring: "ring-success/20",
      label: t("settings.statusConnected"),
    },
    error: {
      icon: XCircle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      ring: "ring-destructive/20",
      label: t("settings.statusError"),
    },
    not_configured: {
      icon: AlertCircle,
      color: "text-warning",
      bg: "bg-warning/10",
      ring: "ring-warning/20",
      label: t("settings.statusNotConfigured"),
    },
    unknown: {
      icon: AlertCircle,
      color: "text-muted-foreground",
      bg: "bg-muted",
      ring: "ring-border",
      label: t("settings.statusUnknown"),
    },
  }[status]
  const StatusIcon = statusInfo.icon

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">
            {t("settings.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.inventorySubtitle")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={loading}>
          <RefreshCw className="size-4" /> {t("common.refresh")}
        </Button>
      </div>

      <div className="rounded-2xl bg-card ring-1 ring-border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <ServerCog className="size-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold">{t("settings.cluster")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("settings.clusterSubtitle")}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={testing || loading}
          >
            {testing ? (
              <RotateCw className="size-4 animate-spin" />
            ) : (
              <Heart className="size-4" />
            )}
            {testing ? t("common.loading") : t("settings.testConnection")}
          </Button>
        </div>

        {error && (
          <div className="p-4 mb-3 bg-destructive/10 ring-1 ring-destructive/20 rounded-lg text-sm text-destructive">
            {error}
          </div>
        )}
        {loading && !config && (
          <div className="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        )}

        {config && (
          <div className="rounded-xl bg-accent/30 ring-1 ring-border p-4">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={cn(
                    "size-10 rounded-xl ring-1 grid place-items-center shrink-0",
                    statusInfo.bg,
                    statusInfo.ring,
                  )}
                >
                  <StatusIcon className={cn("size-5", statusInfo.color)} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{statusInfo.label}</div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {config.url ?? t("settings.noUrl")}
                  </div>
                </div>
              </div>
              <StatusBadge
                variant={status === "connected" ? "healthy" : "degraded"}
                pulse={status === "connected"}
              >
                {status === "connected" ? t("common.healthy") : t("common.degraded")}
              </StatusBadge>
            </div>

            {config.error && (
              <p className="text-[11px] font-mono text-destructive mb-3 break-all">
                {config.error}
              </p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <Readout label={t("settings.region")} value={config.region} />
              <Readout
                label={t("settings.apiKey")}
                value={
                  config.hasApiKey ? t("settings.set") : t("settings.missing")
                }
                tone={config.hasApiKey ? "ok" : "bad"}
              />
              <Readout
                label={t("settings.apiSecret")}
                value={
                  config.hasApiSecret ? t("settings.set") : t("settings.missing")
                }
                tone={config.hasApiSecret ? "ok" : "bad"}
              />
              <Readout
                label={t("settings.liveRooms")}
                value={String(config.roomCount)}
              />
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="bg-card ring-1 ring-border flex-wrap h-auto">
          <TabsTrigger value="dashboard">{t("settings.dashboard")}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("settings.webhooks")}</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <ReadOnlyCard
            title={t("settings.dashboardWiring")}
            description={t("settings.dashboardWiringDesc")}
          >
            <Row
              icon={<Database className="size-4" />}
              label={t("settings.database")}
              description="DATABASE_URL"
              ok={config?.databaseConfigured ?? null}
              okLabel={t("settings.configured")}
              badLabel={t("settings.missing")}
            />
            <Row
              icon={<ServerCog className="size-4" />}
              label={t("settings.sessionSecret")}
              description="DASHBOARD_SESSION_SECRET"
              ok={config?.sessionSecretConfigured ?? null}
              okLabel={t("settings.configured")}
              badLabel={t("settings.missing")}
            />
            <Row
              icon={<Activity className="size-4" />}
              label={t("settings.metricsEndpoint")}
              description="LIVEKIT_METRICS_URL"
              ok={config?.metricsUrl ? true : null}
              okLabel={config?.metricsUrl ?? t("settings.missing")}
              badLabel={t("settings.missing")}
            />
          </ReadOnlyCard>
        </TabsContent>

        <TabsContent value="webhooks" className="mt-4">
          <ReadOnlyCard
            title={t("settings.webhookEndpoint")}
            description={t("settings.webhookEndpointDesc")}
          >
            <WebhookUrl />
          </ReadOnlyCard>

          <div className="mt-4 rounded-2xl bg-card ring-1 ring-border p-6">
            <div className="flex items-start gap-3">
              <Info className="size-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{t("settings.webhookNote")}</p>
                <p>{t("settings.webhookEvents")}</p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** The receive URL is derived from the current origin, not stored anywhere. */
function WebhookUrl() {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const url =
    typeof window === "undefined" ? "" : `${window.location.origin}/api/webhooks/livekit`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t("common.copyFailed"))
    }
  }

  return (
    <div className="rounded-xl bg-accent/30 ring-1 ring-border p-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-xl bg-primary/15 ring-1 ring-primary/20 grid place-items-center shrink-0">
          <Webhook className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{t("settings.webhookEndpoint")}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">{url}</div>
        </div>
        <Button variant="outline" size="sm" onClick={copy} disabled={!url}>
          <Copy className="size-4 me-1" />
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
    </div>
  )
}

function Readout({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "ok" | "bad"
}) {
  return (
    <div className="rounded-lg bg-background/50 ring-1 ring-border p-2.5">
      <div className="text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono mt-0.5 truncate",
          tone === "ok" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * `ok === null` means "not known yet" — the request has not returned, so the row
 * reads as pending rather than guessing either way.
 */
function Row({
  icon,
  label,
  description,
  ok,
  okLabel,
  badLabel,
}: {
  icon: React.ReactNode
  label: string
  description: string
  ok: boolean | null
  okLabel: string
  badLabel: string
}) {
  const { t } = useI18n()
  const pending = ok === null

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl bg-accent/30 ring-1 ring-border px-4 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{label}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">
            {description}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "text-[11px] font-mono shrink-0 text-right",
          pending && "text-muted-foreground",
          ok === true && "text-success",
          ok === false && "text-destructive",
        )}
      >
        {pending ? t("common.loading") : ok ? okLabel : badLabel}
      </div>
    </div>
  )
}

function ReadOnlyCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-card ring-1 ring-border p-6">
      <div className="mb-5">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-3 max-w-2xl">{children}</div>
    </div>
  )
}