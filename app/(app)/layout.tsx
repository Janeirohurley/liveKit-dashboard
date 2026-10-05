import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { authenticate } from "@/lib/auth/session"
import { AppShell } from "@/components/shell/app-shell"

/**
 * Every page under this group requires a session.
 *
 * The check is here rather than in middleware because middleware runs on the Edge
 * runtime and cannot reach Postgres, which is where sessions actually live. The
 * API routes check independently, so this is about not handing an unauthenticated
 * visitor the dashboard shell in the first place.
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const identity = await authenticate(await headers())
  if (!identity) redirect("/login")

  return <AppShell identity={identity}>{children}</AppShell>
}
