// vite.config.ts 的 nomiDropDeadOrtWasmAsset 插件把 onnxruntime-web 那份 22.8MiB 的
// ort-wasm-simd-threaded.jsep.wasm 从安装包里摘掉。它成立的前提只有一条：
//
//   @imgly/background-removal 在创建 InferenceSession 之前，无条件把
//   ort.env.wasm.wasmPaths 指向自己的 CDN —— 于是 onnxruntime-web 自带的
//   `new URL(...jsep.wasm, import.meta.url)` 兜底（以 !wasmPaths 为前提）永不触发。
//
// 这个前提住在第三方 dist 里，升级 @imgly 就可能悄悄失效：那时兜底会复活，
// 去请求一份我们已经不再打包的文件，抠图在真机上直接崩，而任何单测都不会红。
// 所以这里直接对着 node_modules 里那份真实产物断言，把前提本身钉成不变量。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function readImglyBundle(): string {
  const entry = require.resolve('@imgly/background-removal')
  return readFileSync(entry, 'utf8')
}

describe('@imgly/background-removal 打包前提', () => {
  it('仍然在建 session 前自设 ort.env.wasm.wasmPaths', () => {
    // 前提失效 = 插件从「删死代码」变成「删活代码」。这条红了就去掉插件（或改用
    // 官方支持的 publicPath 配置自托管），别只改这条断言。
    const source = readImglyBundle()
    expect(source).toContain('env.wasm.wasmPaths')
  })

  it('wasmPaths 的赋值发生在 InferenceSession.create 之前', () => {
    // 顺序才是关键：设在 create 之后等于没设，兜底照样会跑。
    const source = readImglyBundle()
    const assignedAt = source.indexOf('env.wasm.wasmPaths =')
    const createdAt = source.indexOf('InferenceSession.create')
    expect(assignedAt).toBeGreaterThan(-1)
    expect(createdAt).toBeGreaterThan(-1)
    expect(assignedAt).toBeLessThan(createdAt)
  })

  it('wasmPaths 来自 loadAsUrl（走 config.publicPath / CDN），不是本地打包资产', () => {
    // 若某次升级把 wasmPaths 改成指向随包资产，我们就必须把 .wasm 留在包里。
    const source = readImglyBundle()
    expect(source).toContain('loadAsUrl(`${baseFilePath}.wasm`')
  })
})

// ── 第二个 ort 入口：深度视频节点的推理 worker ──────────────────────────────────
//
// 插件的前提不是「抠图是唯一入口」，而是「**每一个** ort 入口都在 create 之前设了
// wasmPaths」。深度节点在 2026-09-07 加进来时把前提升级成了两个受控入口，这里对第二个
// 逐条断言——否则新增入口会静默把插件从「删死代码」变成「删活代码」，而单测全绿。
describe('深度视频 worker 的 ort 入口', () => {
  // 注释里也会写 "InferenceSession.create"（文件头就解释了这条顺序），先剥注释再看下标，
  // 否则测的是文档而不是代码。
  const workerSource = readFileSync(
    new URL('../workbench/generationCanvas/videoDepth/videoDepth.worker.ts', import.meta.url),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('在 InferenceSession.create 之前设 wasmPaths', () => {
    const assignedAt = workerSource.indexOf('env.wasm.wasmPaths =')
    const createdAt = workerSource.indexOf('InferenceSession.create')
    expect(assignedAt).toBeGreaterThan(-1)
    expect(createdAt).toBeGreaterThan(-1)
    expect(assignedAt).toBeLessThan(createdAt)
  })

  it('wasmPaths 指向随包资产的 nomi-local 通道，不是 CDN', () => {
    // 打包态渲染层是 file://，对 file: 的 fetch 会被跨源拒绝；走 CDN 则等于每次用节点都联网。
    expect(workerSource).toContain('ortWasmBaseUrl')
    expect(workerSource).not.toMatch(/wasmPaths\s*=\s*['"`]https?:/)
  })

  it('只用 webgpu 执行器，没有静默的 wasm 回退', () => {
    // 退 CPU 会把 4 秒的处理变成十几分钟，用户读成「这功能真慢」而不是「我这台机器不支持」。
    expect(workerSource).toContain("executionProviders: [\"webgpu\"]")
    expect(workerSource).not.toContain('executionProviders: ["wasm"]')
  })
})
