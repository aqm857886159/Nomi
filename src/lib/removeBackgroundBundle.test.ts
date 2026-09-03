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
