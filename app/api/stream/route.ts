import { NextRequest } from 'next/server'
import { authenticate } from '@/lib/auth/session'
import { subscribe, type StreamEvent } from '@/lib/events/bus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Server-sent events stream of webhook activity.
 *
 * Auth is checked once at connect. That is a deliberate trade: the browser
 * EventSource API cannot send headers, so the session cookie is the only
 * credential available, and re-authenticating per event would mean closing the
 * stream on logout anyway. A revoked session therefore keeps its already-open
 * stream until it is closed or the heartbeat notices.
 *
 * The periodic comment doubles as a keep-alive, which matters because proxies
 * commonly drop idle connections after 30-60s and a LiveKit room can be quiet
 * for minutes.
 */

const HEARTBEAT_MS = 25_000

function encode(event: StreamEvent): string {
  return `event: webhook\ndata: ${JSON.stringify(event)}\n\n`
}

export async function GET(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const roomParam = req.nextUrl.searchParams.get('room')
  const room = roomParam && roomParam !== 'all' ? roomParam : undefined

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          // The consumer disconnected between the event and this write.
          cleanup()
        }
      }

      const cleanup = () => {
        unsubscribe?.()
        unsubscribe = null
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
      }

      // Tell the client the stream is live before any event arrives.
      send(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`)

      unsubscribe = subscribe(room, (event) => {
        send(`id: ${event.id}\n${encode(event)}`)
      })

      heartbeat = setInterval(() => send(`: keep-alive\n\n`), HEARTBEAT_MS)

      req.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // Already closed by the runtime.
        }
      })
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
