// 抠图 worker 的 config 契约。
//
// 这条测的不是我们的代码长什么样，而是 @imgly 的一个真实机制：
//   init = memoize(initInference, (config) => JSON.stringify(config))
// JSON.stringify 丢掉函数字段 ⇒ 带不同 progress 闭包的两个 config 生成**同一个 memo key**
// ⇒ 第二次调用拿回的是第一次那个 config 对象，removeBackground 内部 config.progress(...)
// 全部打在第一次的闭包上。
//
// 后果是用户可见的：第一次抠图有进度，第二次及以后整段等待零反馈（走查实测 0 次回调）。
// 我们的对策是「整个 worker 复用同一个 config 对象，progress 用稳定函数 + 可变的当前请求 id」。
// 这里把「为什么必须这么写」的那个前提钉住：一旦 @imgly 换成能区分函数的 key（或不再 memoize），
// 这些断言会红，提醒重新评估 worker 里那套 activeRequestId 的写法还需不需要。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function readImglyBundle(): string {
  return readFileSync(require.resolve('@imgly/background-removal'), 'utf8')
}

describe('@imgly config memoization 前提', () => {
  it('init 仍按 JSON.stringify(config) 做 memo key', () => {
    // 这就是「函数字段被丢掉」的根源。
    expect(readImglyBundle()).toContain('memoize_default(initInference, (config) => JSON.stringify(config))')
  })

  it('removeBackground 用的是 init 返回的 config，不是调用方传入的那个', () => {
    // 若它改用调用方的 configuration，每次的新闭包就能生效，我们的稳定 config 也就不再必要。
    const source = readImglyBundle()
    expect(source).toContain('const { config, session } = await init(configuration);')
  })

  it('JSON.stringify 确实抹平只有 progress 不同的两个 config（机制自证）', () => {
    // 不依赖第三方源码的独立佐证：同样的输入，key 一模一样。
    const a = { device: 'cpu', model: 'isnet_quint8', progress: () => 'first' }
    const b = { device: 'cpu', model: 'isnet_quint8', progress: () => 'second' }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('removeBackground.worker 的 config 写法', () => {
  const workerSource = readFileSync(new URL('./removeBackground.worker.ts', import.meta.url), 'utf8')

  it('只有一个 module 级 config，不在每次请求里新建', () => {
    // 回归形态：改回 `function configForRequest(id) { return { ...BASE, progress: ... } }`
    // 会让第二次抠图重新变成零进度反馈，而任何编译/类型检查都不会报错。
    expect(workerSource).toMatch(/const CONFIG: Config = \{/)
    expect(workerSource).not.toMatch(/function configForRequest/)
  })

  it('progress 通过可变的 activeRequestId 归属当前请求', () => {
    expect(workerSource).toContain('activeRequestId')
    expect(workerSource).toMatch(/id: activeRequestId, type: 'progress'/)
  })

  it('请求串行排队，避免两次抠图的进度互相串台', () => {
    expect(workerSource).toMatch(/queue = queue\.then/)
  })
})
