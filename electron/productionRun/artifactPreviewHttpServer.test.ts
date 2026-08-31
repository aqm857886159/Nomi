import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { startArtifactPreviewHttpServer } from './artifactPreviewHttpServer'

const roots: string[] = []
const closes: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closes.splice(0).map((close) => close()))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('production artifact preview HTTP server', () => {
  it('serves a valid handle to an external host with CORS/range support and fails closed otherwise', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-preview-http-'))
    roots.push(root)
    const filePath = path.join(root, 'clip.mp4')
    fs.writeFileSync(filePath, '0123456789')
    const service = {
      resolveArtifactPreview(token: string) {
        if (token !== 'valid') throw new Error('invalid')
        return { filePath, expiresAt: new Date(Date.now() + 60_000).toISOString() }
      },
    }
    const server = await startArtifactPreviewHttpServer(service as never)
    closes.push(server.close)

    const valid = await fetch(`http://127.0.0.1:${server.port}/production-preview?preview=valid`, { headers: { Range: 'bytes=2-4' } })
    expect(valid.status).toBe(206)
    expect(valid.headers.get('access-control-allow-origin')).toBe('*')
    expect(valid.headers.get('cache-control')).toBe('private, no-store')
    expect(await valid.text()).toBe('234')

    await expect(fetch(`http://127.0.0.1:${server.port}/production-preview`).then((response) => response.status)).resolves.toBe(404)
    await expect(fetch(`http://127.0.0.1:${server.port}/production-preview?preview=forged`).then((response) => response.status)).resolves.toBe(404)
  })
})
