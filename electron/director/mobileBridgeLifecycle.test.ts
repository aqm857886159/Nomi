import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileBridgeServer } from './mobileBridgeServer'

describe('mobile bridge lifetime', () => {
  const live: MobileBridgeServer[] = []
  const servers: http.Server[] = []
  afterEach(async () => {
    await Promise.all(live.splice(0).map((bridge) => bridge.stop()))
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })))
    vi.restoreAllMocks()
  })

  function create() {
    const original = http.createServer
    vi.spyOn(http, 'createServer').mockImplementation((...args: Parameters<typeof http.createServer>) => {
      const server = original(...args)
      servers.push(server)
      return server
    })
    const bridge = new MobileBridgeServer(() => {}, { secure: false, host: '127.0.0.1' })
    bridge.grantConsent()
    live.push(bridge)
    return bridge
  }

  it('two concurrent starts share a single listening server', async () => {
    const bridge = create()
    const states = await Promise.all([bridge.start(), bridge.start()])
    expect(states[0].port).toBe(states[1].port)
    expect(servers).toHaveLength(1)
  })

  it('stop during startup drains it before reporting stopped; later restart is independent', async () => {
    const bridge = create()
    const starting = bridge.start()
    await bridge.stop()
    await starting
    expect(bridge.status().running).toBe(false)
    expect(bridge.status().port).toBeNull()
    const restarted = await bridge.start()
    expect(restarted.running).toBe(true)
    await bridge.stop()
    expect(bridge.status().running).toBe(false)
  })
})
