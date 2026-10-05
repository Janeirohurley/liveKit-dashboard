"use client"

import { useMemo, useState } from "react"
import { 
  Copy, 
  KeyRound, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  Sparkles,
  ChevronUp,
  ChevronDown
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { TokenGrants } from "@/lib/livekit-server"
import { formatUptime } from "@/lib/metrics/format"

const TOKEN_TYPES = ["viewer", "publisher", "admin", "custom"] as const
type TokenType = typeof TOKEN_TYPES[number]

/** Mirrors TokenGrants in lib/livekit-server.ts. */
interface AdvancedGrants {
  canPublish: boolean
  canSubscribe: boolean
  canPublishData: boolean
  canPublishSources: string[]
  canUpdateOwnMetadata: boolean
  hidden: boolean
  roomCreate: boolean
  roomList: boolean
  roomAdmin: boolean
  roomRecord: boolean
  ingressAdmin: boolean
  sipAdmin: boolean
  sipCall: boolean
}

/** The presets are the point: each one is a complete grant set, not a delta. */
const PRESETS: Record<Exclude<TokenType, "custom">, AdvancedGrants> = {
  viewer: {
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: [],
    canUpdateOwnMetadata: false,
    hidden: false,
    roomCreate: false,
    roomList: false,
    roomAdmin: false,
    roomRecord: false,
    ingressAdmin: false,
    sipAdmin: false,
    sipCall: false,
  },
  publisher: {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: ["camera", "microphone"],
    canUpdateOwnMetadata: false,
    hidden: false,
    roomCreate: false,
    roomList: false,
    roomAdmin: false,
    roomRecord: false,
    ingressAdmin: false,
    sipAdmin: false,
    sipCall: false,
  },
  admin: {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: ["camera", "microphone", "screen_share", "screen_share_audio"],
    canUpdateOwnMetadata: true,
    hidden: false,
    roomCreate: true,
    roomList: true,
    roomAdmin: true,
    roomRecord: true,
    ingressAdmin: true,
    sipAdmin: true,
    sipCall: true,
  },
}

export function TokensView() {
  const { t } = useI18n()
  const [type, setType] = useState<TokenType>("publisher")
  const [room, setRoom] = useState("webinar-product-launch")
  const [identity, setIdentity] = useState("user_8f2a1b")
  const [exp, setExp] = useState("3600")
  const [metadata, setMetadata] = useState('{"name":"Operator","tier":"pro"}')
  const [perms, setPerms] = useState<AdvancedGrants>(PRESETS.publisher)
  const [token, setToken] = useState("")
  const [reveal, setReveal] = useState(true)
  const [loading, setLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  /**
   * Decode what the server actually issued rather than reconstructing the claims
   * from the form — a guess would drift from the real token the moment a grant
   * changes, which is the one thing this panel exists to check.
   */
  const decoded = useMemo<Record<string, unknown> | null>(() => {
    if (!token || !reveal) return null
    try {
      const payload = token.split(".")[1]
      const json = payload.replace(/-/g, "+").replace(/_/g, "/")
      return JSON.parse(atob(json))
    } catch {
      return null
    }
  }, [token, reveal])

  async function generate() {
    setLoading(true)
    try {
      // Metadata is free-form JSON handed to the participant on join. Validate it
      // here so a typo is a field error rather than a server 500.
      const trimmed = metadata.trim()
      let parsedMetadata: { name?: unknown } = {}
      if (trimmed) {
        let parsed: unknown
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          throw new Error(t("tokens.invalidMetadata"))
        }
        // Any valid JSON parses, so `null`, `42` and `"x"` all reach here.
        // Reading `.name` off a primitive would throw an opaque TypeError that
        // surfaced as a generic failure, so reject non-objects explicitly.
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(t("tokens.invalidMetadata"))
        }
        parsedMetadata = parsed as { name?: unknown }
      }

      const grants: TokenGrants = {
        identity,
        room: room || undefined,
        canPublish: perms.canPublish,
        canSubscribe: perms.canSubscribe,
        canPublishData: perms.canPublishData,
        canPublishSources: perms.canPublishSources.length > 0 ? perms.canPublishSources : undefined,
        canUpdateOwnMetadata: perms.canUpdateOwnMetadata,
        hidden: perms.hidden,
        roomCreate: perms.roomCreate,
        roomList: perms.roomList,
        roomAdmin: perms.roomAdmin,
        roomRecord: perms.roomRecord,
        ingressAdmin: perms.ingressAdmin,
        sipAdmin: perms.sipAdmin,
        sipCall: perms.sipCall,
        ttlSeconds: Number(exp),
        name: typeof parsedMetadata.name === "string" ? parsedMetadata.name : undefined,
        metadata: trimmed || undefined,
      }

      // LiveKit reads an absent grant as "default", so keys the operator did not
      // set are dropped rather than sent as null.
      const body = Object.fromEntries(
        Object.entries(grants).filter(([, v]) => v !== undefined),
      )

      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setToken(data.token)
      toast.success(t("tokens.generated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("tokens.generateFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{t("tokens.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("tokens.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-3 rounded-2xl bg-card ring-1 ring-border p-6 space-y-5">
           <div className="space-y-2">
             <Label>{t("tokens.type")}</Label>
             <div className="grid grid-cols-3 gap-2">
               {TOKEN_TYPES.map((tt) => (
                 <button
                   key={tt}
                   type="button"
                   onClick={() => {
                     setType(tt)
                     if (tt === "custom") {
                       setShowAdvanced(true)
                     } else {
                       setShowAdvanced(false)
                       setPerms(PRESETS[tt])
                     }
                   }}
                   className={cn(
                     "rounded-xl ring-1 px-4 py-3 text-start transition",
                     type === tt
                       ? "ring-primary bg-primary/10"
                       : "ring-border bg-accent/30 hover:bg-accent/60",
                   )}
                 >
                   <div className="text-sm font-semibold capitalize">{t(`tokens.${tt}`)}</div>
                   <div className="text-[11px] text-muted-foreground mt-0.5">
                     {tt === "viewer" && "subscribe-only"}
                     {tt === "publisher" && "publish + subscribe"}
                     {tt === "admin" && "full room control"}
                     {tt === "custom" && "custom permissions"}
                   </div>
                 </button>
               ))}
             </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="room">{t("tokens.room")}</Label>
              <Input id="room" value={room} onChange={(e) => setRoom(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="identity">{t("tokens.identity")}</Label>
              <Input id="identity" value={identity} onChange={(e) => setIdentity(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("tokens.expires")}</Label>
              <Select value={exp} onValueChange={setExp}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="600">10 minutes</SelectItem>
                  <SelectItem value="3600">1 hour</SelectItem>
                  <SelectItem value="21600">6 hours</SelectItem>
                  <SelectItem value="86400">1 day</SelectItem>
                  <SelectItem value="604800">7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meta">{t("tokens.metadata")}</Label>
            <Textarea id="meta" value={metadata} onChange={(e) => setMetadata(e.target.value)} className="font-mono text-xs min-h-20" />
          </div>

           <div className="space-y-3 pt-2 border-t border-border">
             <Label>{t("tokens.permissions")}</Label>
             <div className="space-y-2">
               <div className="flex items-center justify-between rounded-xl bg-accent/30 ring-1 ring-border px-3 py-2.5">
                 <span className="text-sm">{t("tokens.canPublish")}</span>
                 <Switch
                   checked={perms.canPublish}
                   onCheckedChange={(v) => setPerms({ ...perms, canPublish: v })}
                 />
               </div>
               <div className="flex items-center justify-between rounded-xl bg-accent/30 ring-1 ring-border px-3 py-2.5">
                 <span className="text-sm">{t("tokens.canSubscribe")}</span>
                 <Switch
                   checked={perms.canSubscribe}
                   onCheckedChange={(v) => setPerms({ ...perms, canSubscribe: v })}
                 />
               </div>
               <div className="flex items-center justify-between rounded-xl bg-accent/30 ring-1 ring-border px-3 py-2.5">
                 <span className="text-sm">{t("tokens.canPublishData")}</span>
                 <Switch
                   checked={perms.canPublishData}
                   onCheckedChange={(v) => setPerms({ ...perms, canPublishData: v })}
                 />
               </div>
               <div className="flex items-center justify-between rounded-xl bg-accent/30 ring-1 ring-border px-3 py-2.5">
                 <span className="text-sm">{t("tokens.recorder")}</span>
                 <Switch
                   checked={perms.roomRecord}
                   onCheckedChange={(v) => setPerms({ ...perms, roomRecord: v })}
                 />
               </div>
             </div>
             
             {/* Advanced permissions (collapsible) */}
             <div className="mt-4">
               <button
                 type="button"
                 onClick={() => setShowAdvanced(!showAdvanced)}
                 className="text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
               >
                 {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                 <span>{t("tokens.advancedPermissions")}</span>
               </button>
               
               {showAdvanced && (
                 <div className="mt-3 space-y-2 pt-3 border-t border-border">
                   <div className="text-sm font-medium mb-2">{t("tokens.videoPermissions")}</div>
                   <div className="space-y-1">
                     <label className="flex items-center gap-2 text-xs">
                       <Switch
                         checked={perms.hidden}
                         onCheckedChange={(v) => setPerms({ ...perms, hidden: v })}
                       />
                       <span>{t("tokens.hidden")}</span>
                     </label>
                   </div>
                   
                   <div className="mt-2">
                     <label className="block text-xs font-medium mb-1">{t("tokens.publishSources")}</label>
                     <div className="flex flex-wrap gap-2">
                       {["camera", "microphone", "screen_share", "screen_share_audio"].map((source) => (
                         <label key={source} className="flex items-center gap-1 text-xs">
                           <input
                             type="checkbox"
                             checked={perms.canPublishSources.includes(source)}
                             onChange={(e) => {
                               if (e.target.checked) {
                                 setPerms({ ...perms, canPublishSources: [...perms.canPublishSources, source] })
                               } else {
                                 setPerms({ ...perms, canPublishSources: perms.canPublishSources.filter(s => s !== source) })
                               }
                             }}
                             className="h-4 w-4"
                           />
                           <span>{source}</span>
                         </label>
                       ))}
                     </div>
                   </div>
                   
                   <div className="mt-2">
                     <label className="block text-xs font-medium mb-1">{t("tokens.roomPermissions")}</label>
                     <div className="space-y-1">
                       <label className="flex items-center gap-2 text-xs">
                         <Switch
                           checked={perms.roomCreate}
                           onCheckedChange={(v) => setPerms({ ...perms, roomCreate: v })}
                         />
                         <span>{t("tokens.roomCreate")}</span>
                       </label>
                       <label className="flex items-center gap-2 text-xs">
                         <Switch
                           checked={perms.roomList}
                           onCheckedChange={(v) => setPerms({ ...perms, roomList: v })}
                         />
                         <span>{t("tokens.roomList")}</span>
                       </label>
<label className="flex items-center gap-2 text-xs">
                          <Switch
                            checked={perms.roomAdmin}
                            onCheckedChange={(v) => setPerms({ ...perms, roomAdmin: v })}
                          />
                          <span>{t("tokens.roomAdmin")}</span>
                        </label>
                     </div>
                   </div>
                   
                   <div className="mt-2">
                     <label className="block text-xs font-medium mb-1">{t("tokens.sipPermissions")}</label>
                     <div className="space-y-1">
                       <label className="flex items-center gap-2 text-xs">
                         <Switch
                           checked={perms.sipAdmin}
                           onCheckedChange={(v) => setPerms({ ...perms, sipAdmin: v })}
                         />
                         <span>{t("tokens.sipAdmin")}</span>
                       </label>
                       <label className="flex items-center gap-2 text-xs">
                         <Switch
                           checked={perms.sipCall}
                           onCheckedChange={(v) => setPerms({ ...perms, sipCall: v })}
                         />
                         <span>{t("tokens.sipCall")}</span>
                       </label>
                     </div>
                   </div>
                 </div>
               )}
             </div>
           </div>

           <Button onClick={generate} size="lg" className="w-full" disabled={loading}>
             {loading ? t("tokens.generating") : <Sparkles className="size-4" />}
             {t("tokens.generate")}
           </Button>
        </div>

        {/* Output */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl bg-card ring-1 ring-border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-xl bg-primary/15 ring-1 ring-primary/30 grid place-items-center">
                  <KeyRound className="size-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{t("tokens.jwt")}</div>
                  <div className="text-[11px] text-muted-foreground">HS256 • {t("tokens.expiryLabel")} {formatUptime(Number(exp))}</div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setReveal((v) => !v)} aria-label="toggle reveal">
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>

            <div className="rounded-xl bg-background ring-1 ring-border p-3 font-mono text-[11px] break-all min-h-[120px] max-h-48 overflow-auto scrollbar-thin">
              {token ? (
                reveal ? (
                  <span>
                    <span className="text-chart-1">{token.split(".")[0]}</span>
                    <span className="text-muted-foreground">.</span>
                    <span className="text-chart-2">{token.split(".")[1]}</span>
                    <span className="text-muted-foreground">.</span>
                    <span className="text-chart-3">{token.split(".")[2]}</span>
                  </span>
                ) : (
                  "•".repeat(180)
                )
              ) : (
                <span className="text-muted-foreground italic">{t("tokens.issueHint")}</span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              <Button
                variant="outline"
                disabled={!token}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(token)
                    toast.success(t("common.copied"))
                  } catch {
                    toast.error(t("tokens.copyFailed"))
                  }
                }}
              >
                <Copy className="size-4" /> {t("tokens.copyToken")}
              </Button>
            </div>

            <Button variant="ghost" size="sm" onClick={generate} className="w-full text-muted-foreground">
              <RefreshCw className="size-3.5" /> {t("tokens.regenerate")}
            </Button>
          </div>

           <div className="rounded-2xl bg-card ring-1 ring-border p-5 text-xs">
             <div className="flex items-center justify-between mb-2">
               <span className="font-semibold">{t("tokens.decodedPayload")}</span>
               {typeof decoded?.exp === "number" && (
                 <span className="text-muted-foreground">
                   {t("tokens.expires")} {new Date(decoded.exp * 1000).toLocaleString()}
                 </span>
               )}
             </div>
             {decoded ? (
               <pre className="font-mono text-[11px] text-muted-foreground bg-background ring-1 ring-border rounded-xl p-3 overflow-auto scrollbar-thin">
                 {JSON.stringify(decoded, null, 2)}
               </pre>
             ) : (
               <span className="text-muted-foreground italic">
                 {token && !reveal ? t("tokens.revealToDecode") : t("tokens.noPayload")}
               </span>
             )}
           </div>
        </div>
      </div>
    </div>
  )
}
