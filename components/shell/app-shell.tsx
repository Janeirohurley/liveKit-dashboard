"use client"

import { useState } from "react"
import { SidebarNav } from "@/components/shell/sidebar-nav"
import { Topbar } from "@/components/shell/topbar"
import { CommandPalette } from "@/components/shell/command-palette"
import { ErrorBoundary } from "@/components/error-boundary"
import type { AdminIdentity } from "@/lib/auth/session"

/**
 * The layout resolves the session server-side and passes the identity down, so
 * the shell can show who is signed in. Rendering a fixed "Operator /
 * admin@livekit.local" would mean every operator on a shared deployment sees
 * someone else's name, and every audit trail points at the same person.
 */
export function AppShell({
  identity,
  children,
}: {
  identity: AdminIdentity
  children: React.ReactNode
}) {
  const [paletteOpen, setPaletteOpen] = useState(false)

  return (
    <div className="min-h-screen flex bg-background">
      <SidebarNav />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar identity={identity} onCommandPalette={() => setPaletteOpen(true)} />
        <main className="flex-1 p-4 lg:p-8 max-w-[1600px] w-full mx-auto">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}