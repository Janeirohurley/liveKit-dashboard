/**
 * Token grant mapping.
 *
 * These assertions exist because the failure was silent: the token form showed
 * operator-facing switches for `roomAdmin`, `canPublishSources` and `sipCall`,
 * the request body carried them, and `createAccessToken` dropped everything past
 * `canPublishData`. The token looked correct on the page while granting nothing.
 *
 * The tests decode the signed JWT rather than inspecting the object passed in, so
 * they fail if a grant is dropped anywhere between the request and the signature.
 */
import { describe, it, expect } from 'vitest'
import { createAccessToken, type TokenGrants } from './livekit-server'

/** The public half of a JWT — enough to assert on claims. */
function decode(token: string): Record<string, any> {
  const [, payload] = token.split('.')
  const json = Buffer.from(payload, 'base64url').toString('utf8')
  return JSON.parse(json)
}

const BASE: TokenGrants = {
  identity: 'test-identity',
  room: 'test-room',
  ttlSeconds: 3600,
}

describe('createAccessToken', () => {
  it('signs a token whose sub is the requested identity', async () => {
    const claims = decode(await createAccessToken(BASE))
    expect(claims.sub).toBe('test-identity')
  })

  it('sets nbf and exp from ttlSeconds', async () => {
    const claims = decode(await createAccessToken(BASE))
    expect(claims.exp! - claims.nbf).toBe(3600)
  })

  it('defaults to a 6 hour ttl', async () => {
    const claims = decode(await createAccessToken({ identity: 'a', room: 'r' }))
    expect(claims.exp! - claims.nbf).toBe(6 * 60 * 60)
  })

  it('refuses a token without an identity', async () => {
    await expect(createAccessToken({ identity: '', room: 'r' })).rejects.toThrow(/identity/i)
  })

  it('carries every advanced video grant the UI offers', async () => {
    const claims = decode(
      await createAccessToken({
        ...BASE,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
        hidden: true,
        roomCreate: true,
        roomList: true,
        roomRecord: true,
        roomAdmin: true,
        ingressAdmin: true,
      }),
    )

    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: 'test-room',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
      hidden: true,
      roomCreate: true,
      roomList: true,
      roomRecord: true,
      roomAdmin: true,
      ingressAdmin: true,
    })
  })

  it('converts track source names to the values the protocol expects', async () => {
    const claims = decode(
      await createAccessToken({ ...BASE, canPublishSources: ['camera', 'screen_share_audio'] }),
    )
    expect(claims.video.canPublishSources).toEqual(['camera', 'screen_share_audio'])
  })

  it('rejects an unknown track source rather than dropping it', async () => {
    await expect(
      createAccessToken({ ...BASE, canPublishSources: ['telepathy' as string] }),
    ).rejects.toThrow(/Unknown track source/)
  })

  it('omits canPublishSources entirely when none are requested', async () => {
    const claims = decode(await createAccessToken(BASE))
    expect(claims.video).not.toHaveProperty('canPublishSources')
  })

  it('omits the sip grant when no SIP permission is requested', async () => {
    const claims = decode(await createAccessToken(BASE))
    expect(claims).not.toHaveProperty('sip')
  })

  it('adds a sip grant for sipAdmin and sipCall', async () => {
    const claims = decode(await createAccessToken({ ...BASE, sipAdmin: true, sipCall: true }))
    expect(claims.sip).toEqual({ admin: true, call: true })
  })

  it('passes metadata through as the string the protocol expects', async () => {
    const claims = decode(await createAccessToken({ ...BASE, metadata: '{"tier":"pro"}' }))
    expect(claims.metadata).toBe('{"tier":"pro"}')
  })

  it('defaults canPublish and canSubscribe to false rather than granting them', async () => {
    const claims = decode(await createAccessToken(BASE))
    expect(claims.video.canPublish).toBe(false)
    expect(claims.video.canSubscribe).toBe(false)
  })
})