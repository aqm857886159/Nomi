import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ⑭ 起，产品的「删除项目」会把文件夹放进运行者电脑的系统回收站（shell.trashItem）。走查 / 脚本跑在开发者或用户的
// 真机上，收尾要是走产品删除，就会往这台电脑的回收站塞测试垃圾（协调 10-23）。规则：走查建的项目都在自己的隔离
// 临时根里，收尾删临时根（launchNomiApp 的 close() → cleanupTempRoot，测试自己的 fs.rm）；不许调产品删除口，
// 也不许直接调 trashItem，也不许在界面上点项目卡的删除再点确认。单测（*.test.ts）里 electron 是假的、回收站是临时目录，
// 不在这条的范围里。
//
// 删项目这件事从走查里能走到的口一共三个（door-map）：
//   1. 渲染层桥 window.nomiDesktop.projects.delete(...)；
//   2. 直接点名 IPC 通道 nomi:projects:delete；
//   3. 界面：项目卡上的删除按钮 → 确认框 →「删除」。走查只许打开确认框再取消（shell-redesign.walk.mjs 就是这样）。
// 另外 shell.trashItem 本身也不许出现；素材删除（workspace.deleteFiles / nomi:workspace:delete-files）也走它，
// 走查这一侧的口现在就先关上（素材删除的产品改动是下一单）。目前全仓没有走查调它。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ROOTS = ['tests/ux', 'tests/system', 'scripts', 'evals', 'docs/evidence']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'perf-results', 'shots'])
const SELF = 'tests/system/walks-never-trash-projects.test.mjs'
// 唯一的例外：自己建一个一次性磁盘映像当项目所在的盘，真删、真还原，用完卸载删掉——映像卷有自己的废纸篓，
// 用户真实的废纸篓一个字节都不碰。新增例外要在这里写清理由。
const HERMETIC_REAL_TRASH = new Map([
  ['tests/system/real-trash-roundtrip.mjs', '一次性磁盘映像卷上的废纸篓，收尾断言它是空的'],
])
const FORBIDDEN = [
  { pattern: /nomiDesktop\.projects\.delete\s*\(/, why: '调了产品的删除项目口（会进系统回收站）' },
  { pattern: /['"]nomi:projects:delete['"]/, why: '直接点名产品删除 IPC 通道' },
  { pattern: /shell\.trashItem\s*\(/, why: '直接往系统回收站里放东西' },
  // 素材删除是同一类：workspaceFileDelete.ts 也走 shell.trashItem（那条的产品改动是下一单，走查这一侧现在就先关上）。
  { pattern: /nomiDesktop\.workspace\.deleteFiles\s*\(/, why: '调了产品的删除素材口（也会进系统回收站）' },
  { pattern: /['"]nomi:workspace:delete-files['"]/, why: '直接点名产品删除素材 IPC 通道（也会进系统回收站）' },
]
// 素材库的删除（工具栏垃圾桶钮 → 确认框「删除」）也进系统回收站。2026-10-24 之前已打开项目里只在项目里的文件被
// 静默放过，走查 asset-library-interactions ⑤ 点了确认也没真删，所以上面那句「没有走查调它」看不出这扇界面门；修好以后
// 它真删了。走查点了素材库的删除再点确认，只许是登记过、在一次性回收站里跑的那几份（登记要写清理由，且文件里真有
// 一次性映像卷——hdiutil + <卷>/.Trashes）。
const ASSET_DELETE_BUTTON = /tabler-icon-trash/
const DIALOG_CONFIRM = /data-confirm-dialog-confirm|\[role=\\?["']?(?:alert)?dialog\\?["']?\][^\n]*?\bbutton\b/
const DISPOSABLE_TRASH_WALKS = new Map([
  ['tests/ux/asset-library-interactions.walk.mjs', 'macOS 上两个测试项目放在一次性磁盘映像卷上（它自己的废纸篓，⑤ 核对文件进了那里，收尾卸载）；CI 的 runner 用完即毁；其它系统本机跑跳过 ⑤⑥ 真删'],
])
// 项目卡删除按钮的名字（中 / 英）。走查点它之后，紧接着碰的第一个确认框钩子必须是取消，不是确认。
// 同一份走查里别的确认框（删文件夹、退出导演台……）不归这条管，所以看「点完之后最近的那个钩子」，不看整份文件。
// 走查可以直接写名字，也可以从词典读（uiText(…, 'library.deleteNamedProject')），两种写法都要认。
const UI_DELETE_BUTTON = /删除项目|Delete project|uiText\([^)]*['"]library\.deleteNamedProject['"]/g
const CONFIRM_HOOK = /data-confirm-dialog-(cancel|confirm)|Escape/
const HOOK_REACH = 600

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function findViolations(rel, rawSource) {
  if (rel === SELF || HERMETIC_REAL_TRASH.has(rel)) return []
  const source = stripComments(rawSource)
  const hits = FORBIDDEN.filter((rule) => rule.pattern.test(source)).map((rule) => `${rel}：${rule.why}`)
  for (const match of source.matchAll(UI_DELETE_BUTTON)) {
    const next = CONFIRM_HOOK.exec(source.slice(match.index, match.index + HOOK_REACH))
    if (!next) hits.push(`${rel}：点了项目卡的删除按钮，后面没有取消确认框（只许打开确认框再取消）`)
    else if (next[1] === 'confirm') hits.push(`${rel}：点了项目卡的删除按钮，接着点了确认框的「删除」（会把项目放进系统回收站）`)
  }
  // 删除钮常先存进变量、隔很远才点，按「同一份文件里既有素材库垃圾桶钮、又点了确认框的按钮」认。
  if (ASSET_DELETE_BUTTON.test(source) && DIALOG_CONFIRM.test(source) && !DISPOSABLE_TRASH_WALKS.has(rel)) {
    hits.push(`${rel}：点了素材库的删除再确认（会把文件放进系统回收站）；要么只开确认框再取消，要么在一次性回收站里跑并登记进 DISPOSABLE_TRASH_WALKS`)
  }
  return hits
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out)
    } else if (/\.(mjs|cjs|js|mts|cts)$/.test(entry.name) || /\.walk\.|\.e2e\./.test(entry.name)) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

describe('走查与脚本收尾不往系统回收站里扔东西', () => {
  it('tests/ux、tests/system、scripts、evals、docs/evidence 里没有任何产品删除调用、trashItem，也没有点确认删除项目', () => {
    const hits = []
    for (const root of ROOTS) {
      for (const file of walk(path.join(repoRoot, root))) {
        const rel = path.relative(repoRoot, file).split(path.sep).join('/')
        hits.push(...findViolations(rel, fs.readFileSync(file, 'utf8')))
      }
    }
    expect(hits).toEqual([])
  })

  // 门岗自己不能是个恒绿的空壳：三个口各给一个反例，全都要被认出来；只开确认框再取消的走查放行。
  it.each([
    ['桥', "await win.evaluate((pid) => window.nomiDesktop.projects.delete(pid, 'delete-files'), projectId)"],
    ['IPC 通道', "await ipcRenderer.invoke('nomi:projects:delete', id, 'delete-files')"],
    ['trashItem', 'await shell.trashItem(folder)'],
    ['素材删除桥', "await win.evaluate((a) => window.nomiDesktop.workspace.deleteFiles(a), { projectId, relativePaths: ['assets/a.png'] })"],
    ['素材删除 IPC 通道', "await ipcRenderer.invoke('nomi:workspace:delete-files', payload)"],
    ['界面点确认', "await click(card.getByRole('button', { name: '删除项目 天台' })); await click(page.locator('[data-confirm-dialog-confirm]'))"],
    ['界面点删除后没取消', "await click(card.getByRole('button', { name: 'Delete project Rooftop' }))"],
    ['界面点确认（名字从词典读）', "await click(card.getByRole('button', { name: uiText(locale, 'library.deleteNamedProject') })); await click(page.locator('[data-confirm-dialog-confirm]'))"],
    ['素材库删除再确认', "const del = win.locator('button', { has: win.locator('svg.tabler-icon-trash') })\nawait del.click()\nawait win.locator('[role=\"dialog\"] button', { hasText: '删除' }).last().click()"],
    ['素材库删除再确认（确认钩子）', "const del = win.locator('button', { has: win.locator('svg.tabler-icon-trash') }); await del.click(); await win.locator('[data-confirm-dialog-confirm]').click()"],
  ])('反例（%s）被认出来', (_label, source) => {
    expect(findViolations('tests/ux/example.walk.mjs', source)).not.toEqual([])
  })

  it('素材库删除：只开确认框再取消的放行；登记过的走查真在一次性映像卷上跑', () => {
    const cancelOnly = "const del = win.locator('button', { has: win.locator('svg.tabler-icon-trash') }); await del.click(); await win.locator('[data-confirm-dialog-cancel]').click()"
    expect(findViolations('tests/ux/example.walk.mjs', cancelOnly)).toEqual([])
    for (const [rel, why] of DISPOSABLE_TRASH_WALKS) {
      expect(why.length).toBeGreaterThan(8)
      const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
      expect(source, `${rel} 登记成一次性回收站里跑，文件里却没有一次性映像卷`).toMatch(/['"]hdiutil['"]/)
      expect(source, `${rel} 登记成一次性回收站里跑，却没把文件放在映像卷自己的废纸篓里核对`).toMatch(/\.Trashes/)
      expect(findViolations(rel, source)).toEqual([])
    }
  })

  it('只打开确认框再取消的走查放行；一次性磁盘映像上的真删真还原脚本是登记过的例外', () => {
    const cancelOnly = "await click(card.getByRole('button', { name: '删除项目 天台' })); await click(page.locator('[data-confirm-dialog-cancel]'))"
    expect(findViolations('tests/ux/example.walk.mjs', cancelOnly)).toEqual([])
    expect(findViolations('tests/ux/example.walk.mjs', "// 不走产品的「删除项目」，收尾删临时根\nawait close()")).toEqual([]) // 注释里提到不算
    const [hermetic] = [...HERMETIC_REAL_TRASH.keys()]
    expect(findViolations(hermetic, "await click(page.locator('[data-confirm-dialog-confirm]')); await click(card.getByRole('button', { name: /删除项目/ }))")).toEqual([])
    expect(fs.existsSync(path.join(repoRoot, hermetic))).toBe(true)
  })
})
