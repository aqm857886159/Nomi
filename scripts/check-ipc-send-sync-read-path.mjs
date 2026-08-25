import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const source = fs.readFileSync(path.join(root, 'electron', 'preload.ts'), 'utf8')
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'check-ipc-send-sync-read-path-baseline.json'), 'utf8'))
const invokeSyncChannels = [...source.matchAll(/invokeSync(?:<[^>]+>)?\("([^"]+)"/g)].map((match) => match[1])
const uniqueChannels = [...new Set(invokeSyncChannels)]
const directSendSyncCount = (source.match(/ipcRenderer\.sendSync\(/g) || []).length
const allowed = new Set(baseline.allowedSyncChannels)
const forbidden = new Set(baseline.forbiddenAsyncChannels)
const unknown = uniqueChannels.filter((channel) => !allowed.has(channel))
const forbiddenPresent = uniqueChannels.filter((channel) => forbidden.has(channel))

if (directSendSyncCount !== 1) {
  console.error(`❌ IPC sendSync 收口异常：electron/preload.ts 应只有 1 处 ipcRenderer.sendSync，实际 ${directSendSyncCount} 处`)
  process.exit(1)
}
if (unknown.length > 0) {
  console.error(`❌ 新增未审查的同步 IPC channel（先判读路径并更新实现）：${unknown.join(', ')}`)
  process.exit(1)
}
if (forbiddenPresent.length > 0) {
  console.error(`❌ 已异步化读路径回退到 invokeSync：${forbiddenPresent.join(', ')}`)
  process.exit(1)
}

console.log(`✅ IPC sendSync 读路径棘轮通过：${uniqueChannels.length} 个同步 channel 均在审查基线内；${baseline.forbiddenAsyncChannels.length} 个读 channel 禁止回退`)
