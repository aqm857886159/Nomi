// 规则三（被静默丢弃的命令）的红/绿证明。
//
// R17 要求「加规则必须先验它会红」，而且这个红要**留得住**——所以红证明不是一次手工跑，
// 是下面第一条用例：它复刻 #519 修之前那一行真实代码（常驻 Agent 面板里每个会话行的删除钮
// `onClick={() => void removeProjectAgentThread(thread.threadId)}`，Host 对当前会话拒绝
// `thread.remove`，裸 void 把拒绝丢掉、面板的错误条什么都不显示），断言门岗抓得到它。
// 第二条用例是 #519 的修法（runThreadCommand 包一层 .catch），断言门岗放行。
// 谁哪天把规则改窄到抓不住这个 bug，这两条会一起翻红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { discardedCommandOffenders } from './control-contract-discarded-commands.mjs'

const roots = []

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop(), { recursive: true, force: true })
})

/** 造一棵最小仓库：真闸口 src/desktop/bridge.ts + 若干模块 + 一个组件。 */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-control-contract-'))
  roots.push(root)
  const write = (rel, text) => {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  }
  write('src/desktop/bridge.ts', 'export function getDesktopBridge() { return globalThis.nomi }\n')
  for (const [rel, text] of Object.entries(files)) write(rel, text)
  return root
}

function scan(root, componentRel = 'src/ui/Panel.tsx') {
  return discardedCommandOffenders({ root, files: [path.join(root, componentRel)] })
}

/** #519 那个命令模块：dispatch 会因为 Host 拒绝而抛，removeThread 把它原样往外抛。 */
const HOST_COMMANDS = `import { getDesktopBridge } from '../desktop/bridge'
async function dispatch(type: string, payload: unknown) {
  const result = await getDesktopBridge().command({ type, payload })
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}
export async function removeProjectAgentThread(threadId: string) {
  return dispatch('thread.remove', { threadId })
}
`

it('抓得到 #519 修之前那行：裸 void 掉一个会被 Host 拒绝的命令', () => {
  const root = fixture({
    'src/ui/hostCommands.ts': HOST_COMMANDS,
    'src/ui/Panel.tsx': `import { removeProjectAgentThread } from './hostCommands'
export function Panel({ threads }: { threads: { threadId: string }[] }) {
  return <div>{threads.map((thread) => (
    <button key={thread.threadId} onClick={() => void removeProjectAgentThread(thread.threadId)}>删除</button>
  ))}</div>
}
`,
  })
  const offenders = scan(root)
  expect(offenders).toHaveLength(1)
  expect(offenders[0].handler).toBe('onClick')
  expect(offenders[0].command).toBe('removeProjectAgentThread')
})

it('放行 #519 的修法：包一层把拒绝送进错误条', () => {
  const root = fixture({
    'src/ui/hostCommands.ts': HOST_COMMANDS,
    'src/ui/Panel.tsx': `import { removeProjectAgentThread } from './hostCommands'
export function Panel({ threads, setError }: { threads: { threadId: string }[]; setError: (m: string) => void }) {
  const runThreadCommand = (command: () => Promise<unknown>) => { void command().catch((caught) => setError(String(caught))) }
  return <div>{threads.map((thread) => (
    <button key={thread.threadId} onClick={() => runThreadCommand(() => removeProjectAgentThread(thread.threadId))}>删除</button>
  ))}</div>
}
`,
  })
  expect(scan(root)).toEqual([])
})

it('隔着一层本地包装照样抓得到，包装自己 try/catch 了就放行', () => {
  const component = (wrapper) => `import { removeProjectAgentThread } from './hostCommands'
export function Panel({ threadId }: { threadId: string }) {
  ${wrapper}
  return <button onClick={() => void commit()}>删除</button>
}
`
  const bare = fixture({
    'src/ui/hostCommands.ts': HOST_COMMANDS,
    'src/ui/Panel.tsx': component('const commit = async () => { await removeProjectAgentThread(threadId) }'),
  })
  expect(scan(bare)).toHaveLength(1)

  const guarded = fixture({
    'src/ui/hostCommands.ts': HOST_COMMANDS,
    'src/ui/Panel.tsx': component(
      'const commit = async () => { try { await removeProjectAgentThread(threadId) } catch (error) { alert(String(error)) } }',
    ),
  })
  expect(scan(guarded)).toEqual([])
})

it('三种拼法都算丢弃：void、async handler、飘着的 Promise', () => {
  for (const handler of [
    '() => void removeProjectAgentThread(threadId)',
    'async () => { await removeProjectAgentThread(threadId) }',
    '() => { removeProjectAgentThread(threadId) }',
  ]) {
    const root = fixture({
      'src/ui/hostCommands.ts': HOST_COMMANDS,
      'src/ui/Panel.tsx': `import { removeProjectAgentThread } from './hostCommands'
export function Panel({ threadId }: { threadId: string }) {
  return <button onClick={${handler}}>删除</button>
}
`,
    })
    expect(scan(root), handler).toHaveLength(1)
  }
})

it('命令写在一个自己 try/catch 的函数的回调里 → 放行（回调是在它的 try 里跑的）', () => {
  // StoryboardPlanEditor 的 `void runAction(() => generateAnchorCard(…))` 就是这个形状：
  // runAction 里 try/catch 完 toast 了。早一版规则会顺着回调找进去误报它。
  const root = fixture({
    'src/ui/hostCommands.ts': HOST_COMMANDS,
    'src/ui/Panel.tsx': `import { removeProjectAgentThread } from './hostCommands'
export function Panel({ threadId }: { threadId: string }) {
  const runAction = async (action: () => Promise<void>) => {
    try { await action() } catch (error) { toast(String(error), 'error') }
  }
  return <button onClick={() => void runAction(() => removeProjectAgentThread(threadId))}>删除</button>
}
`,
  })
  expect(scan(root)).toEqual([])
})

it('命令自己把失败报给用户（catch 完写状态、不再 reject）就放行', () => {
  const root = fixture({
    'src/ui/hostCommands.ts': `import { getDesktopBridge } from '../desktop/bridge'
export async function recoverResult(id: string) {
  try {
    await getDesktopBridge().recover(id)
  } catch (error) {
    setNodeStatus(id, 'error', String(error))
  }
}
`,
    'src/ui/Panel.tsx': `import { recoverResult } from './hostCommands'
export function Panel({ id }: { id: string }) {
  return <button onClick={() => void recoverResult(id)}>找回</button>
}
`,
  })
  expect(scan(root)).toEqual([])
})

it('直接调桥上的方法也算命令，但 getDesktopBridge() 这句本身不算（它同步返回对象）', () => {
  const root = fixture({
    'src/ui/Panel.tsx': `import { getDesktopBridge } from '../desktop/bridge'
export function Panel({ jobId }: { jobId: string }) {
  return <div>
    <button onClick={() => void getDesktopBridge()?.exports.cancel(jobId)}>取消导出</button>
    <button onClick={() => { const bridge = getDesktopBridge(); bridge?.exports.reveal(jobId) }}>打开</button>
  </div>
}
`,
  })
  const offenders = scan(root)
  expect(offenders).toHaveLength(1)
  expect(offenders[0].command).toContain('cancel')
})

it('注入进来的依赖不算「会 reject」——看不见的东西不硬说', () => {
  // runPasteShareLinkImport 的形状：每个 IPC 都 try/catch 了，只剩一个注入的对话框裸 await。
  const root = fixture({
    'src/ui/hostCommands.ts': `import { getDesktopBridge } from '../desktop/bridge'
export async function runImport(deps: { prompt: () => Promise<string | null> }) {
  const url = await deps.prompt()
  if (!url) return
  try {
    await getDesktopBridge()?.connector.import(url)
  } catch {
    toast('failed', 'error')
  }
}
`,
    'src/ui/Panel.tsx': `import { runImport } from './hostCommands'
export function Panel({ prompt }: { prompt: () => Promise<string | null> }) {
  return <button onClick={() => void runImport({ prompt })}>导入</button>
}
`,
  })
  expect(scan(root)).toEqual([])
})

it('桶文件里再导出的函数要追得过去（追不过去会把它当成会 reject）', () => {
  const root = fixture({
    'src/design/confirmDialogStore.ts': `export function confirmDialog(options: { title: string }): Promise<boolean> {
  return new Promise((resolve) => submit({ ...options, resolve }))
}
`,
    'src/design/index.ts': "export { confirmDialog } from './confirmDialogStore'\n",
    'src/ui/hostCommands.ts': `import { getDesktopBridge } from '../desktop/bridge'
import { confirmDialog } from '../design'
export async function confirmAndDelete(key: string): Promise<{ deleted: boolean }> {
  const ok = await confirmDialog({ title: 'delete' })
  if (!ok) return { deleted: false }
  try {
    getDesktopBridge().modelCatalog.deleteVendor(key)
    return { deleted: true }
  } catch {
    return { deleted: false }
  }
}
`,
    'src/ui/Panel.tsx': `import { confirmAndDelete } from './hostCommands'
export function Panel({ vendorKey }: { vendorKey: string }) {
  const handleDelete = async () => { await confirmAndDelete(vendorKey) }
  return <button onClick={handleDelete}>删除</button>
}
`,
  })
  expect(scan(root)).toEqual([])
})

it('不碰主进程的、以及同步的调用都不算——这条规则只管跨进程命令', () => {
  const root = fixture({
    'src/ui/pure.ts': 'export function copyLabel(text: string) { return text.trim() }\n',
    'src/ui/Panel.tsx': `import { copyLabel } from './pure'
export function Panel({ text }: { text: string }) {
  return <div>
    <button onClick={() => void navigator.clipboard.writeText(text)}>复制</button>
    <button onClick={() => void copyLabel(text)}>标签</button>
  </div>
}
`,
  })
  expect(scan(root)).toEqual([])
})

it('全仓没有被静默丢弃的命令', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const src = path.join(root, 'src')
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry.name)) files.push(full)
    }
  }
  walk(src)
  expect(discardedCommandOffenders({ root, files })).toEqual([])
})
