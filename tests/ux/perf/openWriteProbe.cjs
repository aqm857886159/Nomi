// 性能跑器仪表（mainRequire 注入，主进程入口之前加载）：记下「打开项目」这段时间里主进程碰了哪些写盘调用。
// 只在跑器 arm 之后记；不改任何产品逻辑。读法：app.evaluate(() => globalThis.__nomiOpenWriteProbe.take())。
// 为什么要它：打开项目是读，不该写盘；以前每次打开都会拿清单写锁、fsync 十几次（2026-10-05 L-perf 实测）。
'use strict'
const fs = require('node:fs')

const state = { armed: false, events: [] }
const isWriteFlag = (flags) => (typeof flags === 'string' ? /[wa+]/.test(flags) : typeof flags === 'number' ? (flags & 3) !== 0 : false)
const record = (op, target) => {
  if (!state.armed) return
  const frames = String(new Error().stack).split('\n').slice(3, 9).map((line) => line.trim().replace(/^at /, ''))
  state.events.push({ op, target: typeof target === 'number' ? `fd:${target}` : String(target), frames })
}
const wrapSync = (name, isWrite = () => true) => {
  const original = fs[name]
  if (typeof original !== 'function') return
  fs[name] = function probed(...args) {
    if (isWrite(args)) record(name, args[0])
    return original.apply(this, args)
  }
}
wrapSync('openSync', (args) => isWriteFlag(args[1]))
wrapSync('writeFileSync', (args) => typeof args[0] !== 'number')
wrapSync('appendFileSync')
wrapSync('fsyncSync')
wrapSync('fdatasyncSync')
wrapSync('renameSync')
wrapSync('unlinkSync')
wrapSync('rmSync')
for (const name of ['writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'open']) {
  const original = fs.promises[name]
  if (typeof original !== 'function') continue
  fs.promises[name] = function probed(...args) {
    if (name !== 'open' || isWriteFlag(args[1])) record(`promises.${name}`, args[0])
    return original.apply(this, args)
  }
}

globalThis.__nomiOpenWriteProbe = {
  arm() { state.events = []; state.armed = true },
  take() { state.armed = false; const events = state.events; state.events = []; return events },
}
