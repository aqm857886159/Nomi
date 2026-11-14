// 真付费样本（composer-b3-reference.paid.mjs，步骤本体 _composerB3ReferenceSteps.mjs）的判定先零花费验一遍（V-refleak 第 1 轮的条件）。
//
// 用的是真东西：渲染层 buildCatalogTaskRequest 拼这一档请求（Seedance 2.0 · fast · 480p · 4 秒 · 无音频 · 首尾帧，
// 节点上还躺着 3 张没在用的参考），交给**真的 runtime.runTask**（对等夹具：真内置目录 + globalThis.fetch 捕获），
// 拿到 APIMart 真请求体，再按网络闸的账本形状喂给 judgeReferenceWire。两种节点形状都验：
//   · B3 规范形（付费脚本切到首尾帧之后就是它）：一份有序参考列表，首帧图、尾帧图在前，3 张参考在后；
//   · 旧工程形（10-22 热修那条布的）：按槽存的首 / 尾帧键 + 参考数组里 3 张残留——B3 读进来记「先放一边」。
// 主进程拒发（reference-not-in-use）用**真守卫**抛出的消息验 referenceRejection 读得出来。
// 参考地址用 https 假域名，免得触发本机托管上传；付费那一场里两帧是先托管上传、再按返回地址发的——这里照那个形状
// 补两条「托管上传」账本（文件名 + 返回地址），判定靠它把地址对回 first.png / last.png。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { scrubText } from '../../scripts/walkthrough-url-shape.cjs'

vi.mock('electron', async () => {
  const nodeFs = await import('node:fs')
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const { electronStub } = await import('../../electron/parity/parityElectronMock.ts')
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'nomi-refleak-judge-')))
})
vi.mock('../../electron/capabilityCore/rendererBridge', () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`) },
}))

const { driveEngineA, installFetchCapture, seedParityCatalog } = await import('../../electron/parity/generationParityTestUtils.ts')
const { buildCatalogTaskRequest } = await import('../../src/workbench/generationCanvas/runner/catalogTaskActions.ts')
const { resolveGenerationReferences } = await import('../../src/workbench/generationCanvas/runner/generationReferenceResolver.ts')
const { createGenerationNode } = await import('../../src/workbench/generationCanvas/model/graphOps.ts')
const { assertNoReferenceResidueBeforeSend } = await import('../../electron/tasks/referenceResidueGuard.ts')
const { firstLastSceneProblems, judgeReferenceWire, referenceRejection } = await import('./_referenceLeakWire.mjs')

const HOST = 'api.apimart.ai'
const HOSTED = 'https://upload.apimart.test/hosted/'
const REFERENCE_FILES = ['ref-1.png', 'ref-2.png', 'ref-3.png']
const SCENE = { host: HOST, firstFile: 'first.png', lastFile: 'last.png', referenceFiles: REFERENCE_FILES }
// 托管后的公网地址故意不含原文件名（真上传返回的多半是随机 id），判定只能靠账本把它对回文件名。
const hosted = (file) => `${HOSTED}${Buffer.from(file).toString('hex')}.png?sig=SIGNED&exp=1`

let capture
beforeAll(async () => {
  capture = installFetchCapture()
  await seedParityCatalog(['apimart'])
}, 60_000)
afterAll(() => capture?.restore())

/** 旧工程形（10-22 热修那条布的）：首尾帧方式、按槽存的两帧、3 张残留参考还躺在参考数组里。 */
function sceneNode() {
  const base = createGenerationNode({ id: 'paid-shot', kind: 'video', prompt: '一只橘猫从书桌上跳下，镜头缓慢跟随，写实' })
  return {
    ...base,
    meta: {
      modelKey: 'doubao-seedance-2.0', modelVendor: 'apimart', vendor: 'apimart',
      archetype: { id: 'seedance-2-apimart', modeId: 'firstlast', variantId: 'fast' },
      duration: 4, resolution: '480p', generate_audio: false,
      referenceImageUrls: REFERENCE_FILES.map(hosted),
      firstFrameUrl: hosted('first.png'), lastFrameUrl: hosted('last.png'),
    },
  }
}

/** B3 规范形（composer-b3-reference.paid.mjs 经参数面板切到首尾帧之后）：一份有序参考列表，首帧图、尾帧图、3 张参考。 */
function b3SceneNode() {
  const base = createGenerationNode({ id: 'paid-shot-b3', kind: 'video', prompt: '一只橘猫从书桌上跳下，镜头缓慢跟随，写实' })
  return {
    ...base,
    meta: {
      modelKey: 'doubao-seedance-2.0', modelVendor: 'apimart', vendor: 'apimart',
      archetype: { id: 'seedance-2-apimart', modeId: 'firstlast', variantId: 'fast' },
      duration: 4, resolution: '480p', generate_audio: false,
      referenceImageUrls: ['first.png', 'last.png', ...REFERENCE_FILES].map(hosted),
    },
  }
}
const B3_SCENE = { ...SCENE, localUrlOf: hosted }

/** 新界面里人手在方式格选了首尾帧、只放首帧图和尾帧图（方式按输入现算后，首尾帧唯一做得出来的形状）。 */
function firstLastOnlyNode() {
  const base = b3SceneNode()
  return {
    ...base,
    meta: {
      ...base.meta,
      archetype: { ...base.meta.archetype, modeChosenBy: 'human' },
      referenceImageUrls: ['first.png', 'last.png'].map(hosted),
    },
  }
}

describe('托管地址按 WHATWG 形状对号', () => {
  const filenameShapes = [
    ['空格', 'first ref.png'],
    ['中文', '首帧参考.png'],
    ['#', 'first#frame.png'],
    ['已编码 %20', 'first%20ref.png'],
    ['+', 'first+ref.png'],
  ]
  const responseShapes = [
    ['JSON', false],
    ['JSON 斜杠转义', true],
  ]
  const queryShapes = [
    ['无查询串', ''],
    ['签名已打码', '?<redacted>'],
  ]
  it('响应里的空格地址与请求体的 new URL().href 应对回同一个本地文件', () => {
    const remoteFirst = 'https://cdn.apimart.test/first ref.png?sig=SIGNED'
    const remoteLast = 'https://cdn.apimart.test/last.png?sig=SIGNED'
    const entries = [
      { kind: 'allowed-request', seq: 1, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: 'first ref.png' }] } },
      { kind: 'allowed-response', seq: 1, text: JSON.stringify({ data: { url: remoteFirst } }) },
      { kind: 'allowed-request', seq: 2, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: 'last.png' }] } },
      { kind: 'allowed-response', seq: 2, text: JSON.stringify({ data: { url: remoteLast } }) },
      { kind: 'allowed-request', seq: 3, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/videos/generations', body: { text: JSON.stringify({ image_with_roles: [{ role: "first_frame", url: new URL(remoteFirst).href }, { role: "last_frame", url: new URL(remoteLast).href }] }) } },
    ]
    const verdict = judgeReferenceWire(entries, { host: HOST, firstFile: 'first ref.png', lastFile: 'last.png', referenceFiles: [], localUrlOf: () => '' })
    expect(verdict.problems).toEqual([])
    expect(verdict.summary.imagesInBody.map((entry) => entry.file).sort()).toEqual(['first ref.png', 'last.png'])
  })

  it.each([
    ['空格', 'first ref.png'],
    ['中文', '首帧参考.png'],
    ['#', 'first#frame.png'],
    ['已编码 %20', 'first%20ref.png'],
    ['+', 'first+ref.png'],
  ])('%s 文件名 × JSON / 无查询串', (_label, file) => {
    const lastFile = `last-${file}`
    const firstRemote = `https://cdn.apimart.test/${file}`
    const lastRemote = `https://cdn.apimart.test/${lastFile}`
    const entries = [
      { kind: 'allowed-request', seq: 1, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: file }] } },
      { kind: 'allowed-response', seq: 1, text: JSON.stringify({ data: { url: firstRemote } }).replaceAll('/', '\\/') },
      { kind: 'allowed-request', seq: 2, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: lastFile }] } },
      { kind: 'allowed-response', seq: 2, text: JSON.stringify({ data: { url: lastRemote } }).replaceAll('/', '\\/') },
      { kind: 'allowed-request', seq: 3, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/videos/generations', body: { text: JSON.stringify({ image_with_roles: [{role: "first_frame", url: new URL(firstRemote).href},{role: "last_frame", url: new URL(lastRemote).href}] }) } },
    ]
    const verdict = judgeReferenceWire(entries, { host: HOST, firstFile: file, lastFile, referenceFiles: [] })
    expect(verdict.problems).toEqual([])
  })

  it.each([
    ['无查询串', ''],
    ['签名已打码', '?<redacted>'],
  ])('文件名 + %s 的 JSON 响应和请求体可比', (_label, query) => {
    const file = '首帧 ref+%20#.png'
    const lastFile = '尾帧.png'
    const firstRemote = `https://cdn.apimart.test/${file}${query}`
    const lastRemote = `https://cdn.apimart.test/${lastFile}${query}`
    const entries = [
      { kind: 'allowed-request', seq: 1, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: file }] } },
      { kind: 'allowed-response', seq: 1, text: JSON.stringify({ data: { url: firstRemote } }) },
      { kind: 'allowed-request', seq: 2, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: lastFile }] } },
      { kind: 'allowed-response', seq: 2, text: JSON.stringify({ data: { url: lastRemote } }) },
      { kind: 'allowed-request', seq: 3, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/videos/generations', body: { text: JSON.stringify({ image_with_roles: [{role: "first_frame", url: new URL(firstRemote).href},{role: "last_frame", url: new URL(lastRemote).href}] }) } },
    ]
    const verdict = judgeReferenceWire(entries, { host: HOST, firstFile: file, lastFile, referenceFiles: [] })
    expect(verdict.problems).toEqual([])
  })

  it.each(filenameShapes.flatMap(([filenameLabel, file]) => responseShapes.flatMap(([responseLabel, escapeSlashes]) => queryShapes.map(([queryLabel, query]) => ({ filenameLabel, file, responseLabel, escapeSlashes, queryLabel, query })))))('$filenameLabel × $responseLabel × $queryLabel', ({ file, escapeSlashes, query }) => {
    const lastFile = `last-${file}`
    const pathFor = (name) => name.replaceAll('#', '%23')
    const firstRemote = `https://cdn.apimart.test/${pathFor(file)}${query}`
    const lastRemote = `https://cdn.apimart.test/${pathFor(lastFile)}${query}`
    const responseText = (url) => {
      const json = JSON.stringify({ data: { url } })
      return escapeSlashes ? json.replaceAll('/', '\\/') : json
    }
    const entries = [
      { kind: 'allowed-request', seq: 1, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: file }] } },
      { kind: 'allowed-response', seq: 1, text: responseText(firstRemote) },
      { kind: 'allowed-request', seq: 2, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', body: { form: [{ fileName: lastFile }] } },
      { kind: 'allowed-response', seq: 2, text: responseText(lastRemote) },
      { kind: 'allowed-request', seq: 3, host: HOST, method: 'POST', url: 'https://api.apimart.ai/v1/videos/generations', body: { text: JSON.stringify({ image_with_roles: [{role: "first_frame", url: new URL(firstRemote).href},{role: "last_frame", url: new URL(lastRemote).href}] }) } },
    ]
    expect(judgeReferenceWire(entries, { host: HOST, firstFile: file, lastFile, referenceFiles: [] }).problems).toEqual([])
  })
})

/** 真 runTask 出站那一刻的请求 → 网络闸账本的形状（查询串照闸的规矩换成 `?<redacted>`），外加两条托管上传。 */
async function ledgerFor(node, { uploads = ['first.png', 'last.png'], mutateBody } = {}) {
  const { vendor, request } = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) })
  const record = await driveEngineA(capture, { vendorKey: vendor, kind: request.kind, prompt: request.prompt, extras: { ...request.extras, nodeId: node.id } })
  expect(record.failure, JSON.stringify(record.failure)).toBeUndefined()
  const body = mutateBody ? mutateBody(structuredClone(record.request.body)) : record.request.body
  const scrub = scrubText
  const entries = uploads.flatMap((file, index) => [
    { kind: 'allowed-request', via: 'fetch', seq: index + 1, method: 'POST', url: 'https://api.apimart.ai/v1/uploads/images', host: HOST, body: { form: [{ field: 'file', fileName: file, size: 15237, type: 'image/png' }] } },
    { kind: 'allowed-response', via: 'fetch', seq: index + 1, status: 200, text: scrub(JSON.stringify({ code: 200, data: { url: hosted(file) } })) },
  ])
  entries.push({ kind: 'allowed-request', via: 'fetch', seq: 99, method: 'POST', url: `${record.request.origin}${record.request.path}`, host: new URL(record.request.origin).hostname, body: { text: scrub(JSON.stringify(body)) } })
  return { entries, body }
}

describe('真付费样本的判定：用真 runTask 渲染的 APIMart 首尾帧请求体', () => {
  it('首帧和尾帧按角色各发一次 → 判过', async () => {
    const { entries, body } = await ledgerFor(sceneNode())
    expect(body).not.toHaveProperty("image_urls")
    expect(Array.isArray(body.image_with_roles)).toBe(true)
    const verdict = judgeReferenceWire(entries, SCENE)
    expect(verdict.summary.imageUrlOccurrences).toBe(2)
    expect(verdict.summary.imagesInBody.map((entry) => entry.file).sort()).toEqual(['first.png', 'last.png'])
    expect(verdict.problems).toEqual([])
  })

  it('同一对首尾帧又被放入扁平键，或首尾角色错位，均判失败', async () => {
    for (const mutateBody of [
      body => ({ ...body, image_urls: body.image_with_roles.map(item => item.url) }),
      body => ({ ...body, image_with_roles: [...body.image_with_roles].reverse() }),
    ]) {
      const { entries } = await ledgerFor(sceneNode(), { mutateBody })
      expect(judgeReferenceWire(entries, SCENE).problems.join('、')).toMatch(/各出现一次|角色和文件顺序/)
    }
  })

  it('修前的形状（残留参考混进 image_urls）→ 判红，并点名', async () => {
    const { entries } = await ledgerFor(sceneNode(), {
      uploads: ['first.png', 'last.png', ...REFERENCE_FILES],
      mutateBody: (body) => ({ ...body, image_urls: REFERENCE_FILES.map(hosted) }),
    })
    const verdict = judgeReferenceWire(entries, SCENE)
    expect(verdict.problems.join('\n')).toMatch(/残留参考出现在请求体里/)
    expect(verdict.problems.join('\n')).toMatch(/被托管上传了：ref-1\.png、ref-2\.png、ref-3\.png/)
    expect(verdict.problems.join('\n')).toMatch(/应恰好是 first\.png、last\.png/)
  })

  it('残留参考只是被托管上传了、没进请求体 → 也判红', async () => {
    const { entries } = await ledgerFor(sceneNode(), { uploads: ['first.png', 'last.png', 'ref-2.png'] })
    expect(judgeReferenceWire(entries, SCENE).problems.join('\n')).toMatch(/被托管上传了：ref-2\.png/)
  })

  it('托管上传没记到、地址对不回文件名 → 判红（证明不了只发了两帧，不放过）', async () => {
    const { entries } = await ledgerFor(sceneNode(), { uploads: [] })
    expect(judgeReferenceWire(entries, SCENE).problems.join('\n')).toMatch(/对不回本地文件名/)
  })

  it('不止一次创建请求 → 判红', async () => {
    const { entries } = await ledgerFor(sceneNode())
    const create = entries.at(-1)
    expect(judgeReferenceWire([...entries, { ...create, seq: 100 }], SCENE).problems.join('\n')).toMatch(/视频创建请求有 2 次/)
  })
})

describe('B3 规范形节点（付费脚本切到首尾帧之后）：花钱前场景核对 + 真 runTask 请求体', () => {
  // 方式按输入现算（2026-11-12）：首尾帧只收两张，放了 5 张时首尾帧这个偏好不算数，按收得下全部的参考方式发、5 张都发；
  // 「首尾帧 + 3 张未用到」这个场景新界面里做不出来（方式格里首尾帧置灰并报数）。旧断言「只发首尾两张」属于旧行为，改成新语义。
  it('场景核对仍判过；但请求按参考方式发：没有首尾角色，5 张都在请求体里', async () => {
    const node = b3SceneNode()
    expect(firstLastSceneProblems(node.meta, B3_SCENE)).toEqual([])
    const { body } = await ledgerFor(node, { uploads: ['first.png', 'last.png', ...REFERENCE_FILES] })
    expect(body).not.toHaveProperty('image_with_roles')
    const sent = JSON.stringify(body)
    for (const file of ['first.png', 'last.png', ...REFERENCE_FILES]) expect(sent).toContain(hosted(file))
  })

  it('人手选了首尾帧、只放首尾两张 → 按首尾帧发，请求体恰好 first.png、last.png', async () => {
    const node = firstLastOnlyNode()
    const { entries, body } = await ledgerFor(node)
    expect(body).not.toHaveProperty('image_urls')
    expect(Array.isArray(body.image_with_roles)).toBe(true)
    const verdict = judgeReferenceWire(entries, B3_SCENE)
    expect(verdict.summary.imagesInBody.map((entry) => entry.file).sort()).toEqual(['first.png', 'last.png'])
  })

  it('场景核对的反例：还停在参考方式、首尾帧排反、首帧标成特意空着、少一张参考 → 各自点名', () => {
    const { meta } = b3SceneNode()
    expect(firstLastSceneProblems({ ...meta, archetype: { ...meta.archetype, modeId: 'omni' } }, B3_SCENE).join('\n')).toMatch(/当前方式是 omni，不是首尾帧/)
    const swapped = ['last.png', 'first.png', ...REFERENCE_FILES].map(hosted)
    expect(firstLastSceneProblems({ ...meta, referenceImageUrls: swapped }, B3_SCENE).join('\n')).toMatch(/最前面两张不是 first\.png、last\.png[^：]*：last\.png、first\.png/)
    expect(firstLastSceneProblems({ ...meta, referenceFirstFrameEmpty: true }, B3_SCENE).join('\n')).toMatch(/特意空着/)
    const short = meta.referenceImageUrls.filter((url) => url !== hosted('ref-2.png'))
    expect(firstLastSceneProblems({ ...meta, referenceImageUrls: short }, B3_SCENE).join('\n')).toMatch(/缺 ref-2\.png/)
    expect(firstLastSceneProblems(undefined, B3_SCENE)).toHaveLength(3)
  })
})

describe('主进程拒发（reference-not-in-use）落在节点上读得出来', () => {
  it('绕过渲染层、把节点 meta 原样塞进 extras：真守卫拒发，消息经 IPC 包装存进节点 → referenceRejection 点名', () => {
    // 渲染层按首尾帧组好的请求（只有两帧），通用参考键里却多塞了 3 张——有新入口绕过了渲染层（方式按输入现算后渲染层自己做不出这种请求）。
    const node = firstLastOnlyNode()
    const { request } = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) })
    const raw = { ...node.meta, referenceImageUrls: [...node.meta.referenceImageUrls, ...REFERENCE_FILES.map(hosted)], archetypeInput: request.extras?.archetypeInput ?? {} }
    let message = ''
    try { assertNoReferenceResidueBeforeSend(raw, 'paid-shot-b3') } catch (error) { message = String(error?.message ?? error) }
    expect(message).toMatch(/NOMI_ERR::reference-not-in-use::/)
    // 渲染层存的是原样消息；经 IPC 回来的错会被包一层前缀，码标记还在。
    const stored = `Error invoking remote method 'nomi:tasks:run': Error: ${message}`
    expect(referenceRejection({ status: 'error', error: stored, runs: [{ status: 'error', error: stored }] })).toEqual({ where: 'node.error', excerpt: stored.slice(0, 240) })
    expect(referenceRejection({ status: 'error', runs: [{ status: 'success' }, { status: 'error', error: stored }] })?.where).toBe('runs[1].error')
  })

  it('成功的、别的错（上传失败等）、读不到节点 → 不算拒发', () => {
    expect(referenceRejection({ status: 'success', runs: [{ status: 'success' }] })).toBeNull()
    expect(referenceRejection({ status: 'error', error: 'NOMI_ERR::asset-upload-failed:: all upload channels failed', runs: [{ status: 'error', error: 'NOMI_ERR::asset-upload-failed:: x' }] })).toBeNull()
    expect(referenceRejection(undefined)).toBeNull()
  })
})
