import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { contentTypeFromPath } from '../assets/assetPaths'
import { setArtifactPreviewHttpOrigin } from './artifactProjection'
import type { ProductionRunService } from './productionRunService'

type PreviewService = Pick<ProductionRunService, 'resolveArtifactPreview'>

function previewHeaders(filePath: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': contentTypeFromPath(filePath),
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
    ...extra,
  }
}

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || size <= 0 || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const length = Number.parseInt(match[2], 10)
    return Number.isFinite(length) && length > 0 ? { start: Math.max(0, size - length), end: size - 1 } : null
  }
  const start = Number.parseInt(match[1], 10)
  const end = match[2] ? Number.parseInt(match[2], 10) : size - 1
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start && start < size
    ? { start, end: Math.min(end, size - 1) }
    : null
}

export async function handleArtifactPreviewHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  service: PreviewService,
): Promise<boolean> {
  const parsed = new URL(req.url || '/', 'http://127.0.0.1')
  if (parsed.pathname !== '/production-preview') return false
  try {
    if (!['GET', 'HEAD'].includes(req.method || '')) throw new Error('Method not allowed')
    const keys = [...parsed.searchParams.keys()]
    if (keys.length !== 1 || keys[0] !== 'preview') throw new Error('Invalid preview query')
    const resolved = service.resolveArtifactPreview(parsed.searchParams.get('preview') || '')
    const stat = fs.statSync(resolved.filePath)
    if (!stat.isFile()) throw new Error('Preview is not a file')
    const rangeValue = Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range
    if (rangeValue) {
      const range = parseRange(rangeValue, stat.size)
      if (!range) {
        res.writeHead(416, previewHeaders(resolved.filePath, { 'Content-Range': `bytes */${stat.size}` }))
        res.end()
        return true
      }
      res.writeHead(206, previewHeaders(resolved.filePath, {
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      }))
      if (req.method === 'HEAD') res.end()
      else fs.createReadStream(resolved.filePath, { start: range.start, end: range.end }).pipe(res)
      return true
    }
    res.writeHead(200, previewHeaders(resolved.filePath, { 'Content-Length': String(stat.size) }))
    if (req.method === 'HEAD') res.end()
    else fs.createReadStream(resolved.filePath).pipe(res)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end('Production preview not found')
  }
  return true
}

export function startArtifactPreviewHttpServer(service: PreviewService): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    void handleArtifactPreviewHttpRequest(req, res, service).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404)
        res.end()
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const origin = `http://127.0.0.1:${port}`
      setArtifactPreviewHttpOrigin(origin)
      resolve({
        port,
        close: () => new Promise<void>((resolveClose) => server.close(() => {
          setArtifactPreviewHttpOrigin(null)
          resolveClose()
        })),
      })
    })
  })
}
