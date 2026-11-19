/**
 * Local live relay: a stand-in for Ably during `npm run dev` and in CI.
 *
 * It runs inside the Vite dev server and never ships to Netlify. Functions
 * publish to it over HTTP (see server/lib/live.ts), and browsers listen with
 * Server-Sent Events (see src/live/local-transport.ts). It enforces the same
 * capabilities as the Ably tokens: a browser only hears the channels its
 * token names, and can only enter presence where the token allows it.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

import { type Capability, channelAllowed, verifyLocalToken } from '../../server/lib/live-local.ts'

interface Connection {
  id: string
  clientId: string
  capability: Capability
  res: ServerResponse
}

interface PresenceMember {
  clientId: string
  connectionId: string
  data: unknown
  timestamp: number
}

const PREFIX = '/__live'

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString() || '{}')
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

export function liveRelay(): Plugin {
  const secret = process.env.LIVE_RELAY_SECRET ?? randomBytes(24).toString('base64url')
  process.env.LIVE_RELAY_SECRET = secret
  const connections = new Map<string, Connection>()
  const presence = new Map<string, Map<string, PresenceMember>>()

  function broadcast(channel: string, frame: object) {
    const line = `data: ${JSON.stringify(frame)}\n\n`
    for (const conn of connections.values()) {
      if (channelAllowed(conn.capability, channel, 'subscribe')) conn.res.write(line)
    }
  }

  function presenceAction(
    channel: string,
    action: 'enter' | 'update' | 'leave',
    member: PresenceMember,
  ) {
    const members = presence.get(channel) ?? new Map<string, PresenceMember>()
    presence.set(channel, members)
    if (action === 'leave') members.delete(member.connectionId)
    else members.set(member.connectionId, member)
    broadcast(channel, { type: 'presence', channel, action, member })
  }

  return {
    name: 'anzul-live-relay',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        if (address && typeof address === 'object') {
          process.env.LIVE_RELAY_URL = `http://localhost:${address.port}${PREFIX}`
        }
      })

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next()
        const url = new URL(req.url, 'http://localhost')
        const route = url.pathname.slice(PREFIX.length)

        try {
          if (route === '/publish' && req.method === 'POST') {
            if (req.headers['x-live-secret'] !== secret)
              return send(res, 403, { error: 'bad secret' })
            const body = (await readJson(req)) as {
              messages: { channel: string; name: string; data: unknown }[]
            }
            for (const msg of body.messages) {
              broadcast(msg.channel, {
                type: 'message',
                channel: msg.channel,
                name: msg.name,
                data: msg.data,
                id: randomUUID(),
                timestamp: Date.now(),
              })
            }
            return send(res, 200, { ok: true })
          }

          if (route === '/stream' && req.method === 'GET') {
            const token = verifyLocalToken(url.searchParams.get('token') ?? '', secret)
            if (!token) return send(res, 401, { error: 'bad token' })
            const id = randomUUID()
            res.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
            })
            res.write(`data: ${JSON.stringify({ type: 'ready', connectionId: id })}\n\n`)
            connections.set(id, { id, clientId: token.clientId, capability: token.capability, res })
            const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
            req.on('close', () => {
              clearInterval(ping)
              connections.delete(id)
              for (const [channel, members] of presence) {
                const member = members.get(id)
                if (member) presenceAction(channel, 'leave', member)
              }
            })
            return
          }

          if (route === '/presence' && req.method === 'POST') {
            const body = (await readJson(req)) as {
              token: string
              connectionId: string
              channel: string
              action: 'enter' | 'update' | 'leave'
              data?: unknown
            }
            const token = verifyLocalToken(body.token, secret)
            const conn = connections.get(body.connectionId)
            if (!token || !conn || conn.clientId !== token.clientId) {
              return send(res, 401, { error: 'bad token' })
            }
            if (!channelAllowed(token.capability, body.channel, 'presence')) {
              return send(res, 403, { error: 'presence not allowed on this channel' })
            }
            presenceAction(body.channel, body.action, {
              clientId: token.clientId,
              connectionId: body.connectionId,
              data: body.data ?? null,
              timestamp: Date.now(),
            })
            return send(res, 200, { ok: true })
          }

          if (route === '/presence' && req.method === 'GET') {
            const token = verifyLocalToken(url.searchParams.get('token') ?? '', secret)
            const channel = url.searchParams.get('channel') ?? ''
            if (!token || !channelAllowed(token.capability, channel, 'subscribe')) {
              return send(res, 401, { error: 'bad token' })
            }
            return send(res, 200, { members: [...(presence.get(channel)?.values() ?? [])] })
          }

          return send(res, 404, { error: 'unknown live relay route' })
        } catch (error) {
          return send(res, 500, { error: String(error) })
        }
      })
    },
  }
}
