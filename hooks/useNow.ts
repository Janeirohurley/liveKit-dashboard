"use client"

import { useEffect, useState } from "react"

/**
 * A stable "current time" for relative timestamps.
 *
 * `Date.now()` called during render is an impure read: every re-render produces
 * a different duration for the same room, and React can render a component
 * without committing it, so the label can flicker or disagree with what the user
 * sees. Ticking on an interval gives every component in one pass the same value
 * and keeps "3m ago" honest on its own.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}