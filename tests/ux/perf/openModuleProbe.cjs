// 性能跑器仪表（mainRequire 注入，主进程入口之前加载）：记下「打开项目」这段时间里主进程**新装载**了哪些模块。
// 用 Node 官方的 module.registerHooks 的 load 钩子（只在真装载时调用，命中缓存不算）。不改任何产品逻辑。
// 读法：app.evaluate(() => globalThis.__nomiOpenModuleProbe.take())。
// 为什么要它：打开项目的路径曾经静态拖进 pi-coding-agent 整个入口（约 1500 个文件，主进程同步装载）。
'use strict'
const module_ = require('node:module')

const state = { armed: false, loaded: [] }
if (typeof module_.registerHooks === 'function') {
  module_.registerHooks({
    load(url, context, nextLoad) {
      if (state.armed && url.startsWith('file:')) state.loaded.push(url)
      return nextLoad(url, context)
    },
  })
}

globalThis.__nomiOpenModuleProbe = {
  supported: typeof module_.registerHooks === 'function',
  arm() { state.loaded = []; state.armed = true },
  take() {
    state.armed = false
    const loaded = state.loaded
    state.loaded = []
    // file: URL 里的分隔符永远是 /（Windows 也一样），只按 / 切。
    const packageOf = (url) => decodeURIComponent(url).match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/)?.[1] ?? 'app'
    const byPackage = {}
    for (const url of loaded) { const name = packageOf(url); byPackage[name] = (byPackage[name] || 0) + 1 }
    return {
      count: loaded.length,
      piCodingAgentEntry: loaded.some((url) => /pi-coding-agent\/dist\/index\.js$/.test(decodeURIComponent(url))),
      byPackage,
    }
  },
}
