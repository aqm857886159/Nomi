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
import { copyOffenders } from './control-contract-copy.mjs'

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

/* ───────────── 规则四~六：控件文案契约（设计系统 §1.8）的红/绿证明 ─────────────
 *
 * R17：加规则必须先验它会红，而且这个红要留得住。下面四条用例复刻的是
 * 2026-09-10 用户当场点名的那一屏——分镜面上并排四颗文字按钮
 * （「不要」「全部生成」「换模型」「返回修改」），没有一颗是主动作。
 * 谁把规则改窄到抓不住它们，这几条会一起翻红。
 */

/** 造一棵带 i18n 词典与 GLOSSARY 的最小仓库。 */
function copyFixture(labels, componentSource) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-control-copy-'))
  roots.push(root)
  const write = (rel, text) => {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  }
  const zh = Object.entries(labels).map(([key, [zhText]]) => `  ${key}: ${JSON.stringify(zhText)},`).join('\n')
  const en = Object.entries(labels).map(([key, [, enText]]) => `  ${key}: ${JSON.stringify(enText)},`).join('\n')
  write('src/i18n/locales/panel.ts', `export const zhPanel = {\n${zh}\n}\nexport const enPanel = {\n${en}\n}\n`)
  write('src/i18n/resources.ts', `import { enPanel, zhPanel } from './locales/panel'
export const zhCN = { panel: zhPanel }
export const en = { panel: enPanel }
`)
  write('docs/GLOSSARY.md', `# 术语表

## 动作词（按钮 / 菜单文案的规范动词）

| 规范名 | 替代说法（整条文案等于它即红） | 英文 | 用在哪 |
|---|---|---|---|
| **确认** | 确定 · 知道了 | Confirm | \`common.confirm\` |
| **取消** | 算了 · 不要 | Cancel | \`common.cancel\` |
`)
  write('src/ui/Panel.tsx', componentSource)
  return root
}

const copyScan = (root) => copyOffenders({ root, files: [path.join(root, 'src/ui/Panel.tsx')] })

it('抓得到 2026-09-10 那一屏：四颗文字按钮里的超长标签、口语否定词、第二种说法', () => {
  const root = copyFixture(
    {
      decline: ['不要', 'No thanks'],
      generateAll: ['全部生成', 'Generate all shots'],
      changeModel: ['换模型', 'Change model'],
      backToEdit: ['返回修改', 'Back to editing'],
      ack: ['知道了', 'Got it'],
    },
    `export function Panel({ t }: { t: (k: string) => string }) {
  return <div>
    <button onClick={() => act('decline')}>{t('panel.decline')}</button>
    <button onClick={() => act('all')}>{t('panel.generateAll')}</button>
    <button onClick={() => act('model')}>{t('panel.changeModel')}</button>
    <button onClick={() => act('back')}>{t('panel.backToEdit')}</button>
    <button onClick={() => act('ack')}>{t('panel.ack')}</button>
  </div>
}
`,
  )
  const offenders = copyScan(root)
  const by = (rule) => offenders.filter((o) => o.rule === rule).map((o) => o.key)
  // 「不要」= 口语否定词（规则 4 要求统一收敛成 ×／统一次按钮样式）
  expect(by('banned')).toContain('panel.decline')
  // 「知道了」= 「确认」的第二种说法
  expect(by('synonym')).toContain('panel.ack')
  // 英文侧：三词以上的标签
  expect(by('long-en')).toEqual(expect.arrayContaining(['panel.generateAll', 'panel.backToEdit']))
  // 中文四个字以内的（「全部生成」「换模型」「返回修改」）长度上过关——
  // 它们的问题是「一屏四颗文字按钮」，那是构图判断，门岗故意不猜。
  expect(by('long')).toEqual([])
})

it('抓得到超过 4 个字的中文标签', () => {
  const root = copyFixture(
    { longOne: ['把这一镜的参数套用到全部', 'Apply all'] },
    `export function Panel({ t }: { t: (k: string) => string }) {
  return <button onClick={() => act()}>{t('panel.longOne')}</button>
}
`,
  )
  const offenders = copyScan(root)
  expect(offenders.map((o) => o.rule)).toContain('long')
  expect(offenders.find((o) => o.rule === 'long').detail).toContain('12 字')
})

it('放行合规写法：≤4 字动词开头的主动作 + icon 按钮的 hover 名字', () => {
  const root = copyFixture(
    { generate: ['生成 ¥1.20', 'Generate'], undoName: ['撤销时间轴编辑', 'Undo timeline edit'] },
    `import { WorkbenchIconButton } from '../design/actions'
export function Panel({ t }: { t: (k: string) => string }) {
  return <div>
    <button onClick={() => act()}>{t('panel.generate')}</button>
    <WorkbenchIconButton label={t('panel.undoName')} icon={null} onClick={() => act()} />
  </div>
}
`,
  )
  // hover 名字（aria-label/title/icon 按钮的 label）刻意不受长度约束——
  // 规则 1 就是要「icon + hover 名字」，拿标签的尺子去量它等于把正确写法判红。
  expect(copyScan(root)).toEqual([])
})

it('说明文字不是标签：带句读的、以 Hint/Description 结尾的键不判', () => {
  const root = copyFixture(
    { deleteFolderHint: ['删除文件夹（素材回到未分类，不删文件）', 'Delete folder (assets are kept)'] },
    `export function Panel({ t }: { t: (k: string) => string }) {
  return <button onClick={() => act()}>{t('panel.deleteFolderHint')}</button>
}
`,
  )
  expect(copyScan(root)).toEqual([])
})

it('全仓控件文案违规不超过棘轮基线', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(root, 'src'))
  const baseline = new Set(JSON.parse(fs.readFileSync(path.join(root, 'scripts/control-copy-baseline.json'), 'utf8')).offenders)
  const added = copyOffenders({ root, files }).filter((o) => !baseline.has(o.id))
  expect(added).toEqual([])
})
