import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/nomi-comfyui-workflow-matrix', getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  webContents: { getAllWebContents: () => [] },
}))

import { executeProfileOperation } from './runtime'
import {
  analyzeComfyWorkflow,
  buildComfyImportModelMapping,
  buildImportedWorkflow,
  type ComfyGraph,
} from './catalog/comfyuiWorkflowImport'
import type { LocalAssetReader } from './catalog/assetLocalization'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])
const LOCAL_ASSET = (name: string, contentType: string): ReturnType<LocalAssetReader> => ({
  bytes: contentType === 'image/png' ? PNG_BYTES : Buffer.from(`bytes:${name}`), fileName: name, contentType,
})

const MULTI_MEDIA_GRAPH: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'author-a.png' } },
  '2': { class_type: 'LoadImage', inputs: { image: 'author-b.png' } },
  '3': { class_type: 'LoadImage', inputs: { image: 'author-c.png' } },
  '4': { class_type: 'LoadVideo', inputs: { file: 'author.mp4' } },
  '5': { class_type: 'MediaMixer', inputs: { a: ['1', 0], b: ['2', 0], c: ['3', 0], video: ['4', 0] } },
  '9': { class_type: 'SaveVideo', inputs: { video: ['5', 0], filename_prefix: 'Nomi' } },
}

let server: http.Server
let baseUrl = ''
let uploadCount = 0
let promptBodies: Array<Record<string, unknown>> = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://placeholder')
    if (req.method === 'POST' && url.pathname === '/upload/image') {
      uploadCount += 1
      req.on('data', () => {})
      req.on('end', () => {
        const name = `nomi-input-${uploadCount}${uploadCount === 4 ? '.mp4' : '.png'}`
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ name, subfolder: '', type: 'input' }))
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/prompt') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        promptBodies.push(JSON.parse(body) as Record<string, unknown>)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ prompt_id: 'matrix-prompt-1' }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server?.close())
beforeEach(() => {
  uploadCount = 0
  promptBodies = []
})

describe('ComfyUI generic workflow HTTP boundary', () => {
  it('uploads every declared image/video parameter and injects matching Comfy filenames', async () => {
    const imported = buildImportedWorkflow(MULTI_MEDIA_GRAPH, analyzeComfyWorkflow(MULTI_MEDIA_GRAPH).suggested)
    const { model, mapping } = buildComfyImportModelMapping(imported, {
      modelKey: 'comfy-matrix', labelZh: '矩阵工作流',
    })
    const localAssets: Record<string, ReturnType<LocalAssetReader>> = {
      'nomi-local://a': LOCAL_ASSET('a.png', 'image/png'),
      'nomi-local://b': LOCAL_ASSET('b.png', 'image/png'),
      'nomi-local://c': LOCAL_ASSET('c.png', 'image/png'),
      'nomi-local://v': LOCAL_ASSET('v.mp4', 'video/mp4'),
    }
    const request = {
      kind: mapping.taskKind,
      prompt: '',
      extras: {
        ...Object.fromEntries(imported.parameters.map((parameter, index) => [parameter.key, `nomi-local://${['a', 'b', 'c', 'v'][index]}`])),
      },
    }
    const vendor = { key: 'comfyui-local', baseUrlHint: baseUrl, enabled: true, authType: 'none', authHeader: null } as never
    const executed = await executeProfileOperation({
      vendor, model: model as never, apiKey: '', request: request as never,
      operation: mapping.create as never,
      localAssetReader: (url) => localAssets[url] ?? null,
    })

    expect(uploadCount).toBe(4)
    expect(promptBodies).toHaveLength(1)
    const prompt = promptBodies[0]?.prompt as Record<string, { inputs?: Record<string, unknown> }>
    expect(prompt['1']?.inputs?.image).toBe('nomi-input-1.png')
    expect(prompt['2']?.inputs?.image).toBe('nomi-input-2.png')
    expect(prompt['3']?.inputs?.image).toBe('nomi-input-3.png')
    expect(prompt['4']?.inputs?.file).toBe('nomi-input-4.mp4')
    expect(executed.response).toEqual({ prompt_id: 'matrix-prompt-1' })
  })

  it('keeps an unbound author example while injecting only the selected media input', async () => {
    const binding = {
      images: [{ nodeId: '1', inputKey: 'image', paramKey: 'comfy_selected', label: '选中', mediaKind: 'image' as const }],
      outputNodeId: '9', outputKind: 'video' as const,
      params: [],
    }
    const imported = buildImportedWorkflow(MULTI_MEDIA_GRAPH, binding)
    const { model, mapping } = buildComfyImportModelMapping(imported, { modelKey: 'comfy-matrix-selected', labelZh: '只选一张' })
    await executeProfileOperation({
      vendor: { key: 'comfyui-local', baseUrlHint: baseUrl, enabled: true, authType: 'none', authHeader: null } as never,
      model: model as never,
      apiKey: '',
      request: { kind: mapping.taskKind, prompt: '', extras: { comfy_selected: 'nomi-local://a' } } as never,
      operation: mapping.create as never,
      localAssetReader: (url) => url === 'nomi-local://a' ? LOCAL_ASSET('a.png', 'image/png') : null,
    })

    expect(uploadCount).toBe(1)
    const prompt = promptBodies[0]?.prompt as Record<string, { inputs?: Record<string, unknown> }>
    expect(prompt['1']?.inputs?.image).toBe('nomi-input-1.png')
    expect(prompt['2']?.inputs?.image).toBe('author-b.png')
    expect(prompt['3']?.inputs?.image).toBe('author-c.png')
    expect(prompt['4']?.inputs?.file).toBe('author.mp4')
  })

  it('blocks a missing selected asset before submitting /prompt', async () => {
    const imported = buildImportedWorkflow(MULTI_MEDIA_GRAPH, {
      images: [{ nodeId: '1', inputKey: 'image', paramKey: 'comfy_missing', label: '缺失', mediaKind: 'image' }],
      outputNodeId: '9', outputKind: 'video', params: [],
    })
    const { model, mapping } = buildComfyImportModelMapping(imported, { modelKey: 'comfy-matrix-missing', labelZh: '缺素材' })
    await expect(executeProfileOperation({
      vendor: { key: 'comfyui-local', baseUrlHint: baseUrl, enabled: true, authType: 'none', authHeader: null } as never,
      model: model as never, apiKey: '',
      request: { kind: mapping.taskKind, prompt: '', extras: { comfy_missing: 'nomi-local://gone' } } as never,
      operation: mapping.create as never,
      localAssetReader: () => null,
    })).rejects.toThrow(/本地文件读取失败|素材/)
    expect(promptBodies).toHaveLength(0)
  })
})
