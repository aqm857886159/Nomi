// 设计实验室状态清单的**共享读取口**（走查、视觉基线 spec、门岗三处共用一份）。
//
// 为什么用源码正则而不是 import：注册表是 .tsx（含 JSX + TS 类型），node 直接 import 不了；
// 而把清单再抄一份 JSON 就是第二个真相源——正是本实验室要消灭的那种东西。
//
// 这把正则的活性由走查兜底：`design-lab-<屏>.walk.mjs` 会拿活页面的
// `window.__designLabStates` 和这里的解析结果逐项比对，对不上当场红。
// 没有那道比对，一个解析漏项会静默地少截一张图、少比一条基线——典型的假绿。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const CALIBRATION_FILE = path.join(REPO_ROOT, 'tests/ux/design-lab/calibration.json')
const BASELINE_ROOT = path.join(REPO_ROOT, 'tests/ux/design-lab/__baselines__')

/**
 * 屏的登记表。**必须与 `src/devlab/designLab/labScreens.ts` 一一对应**——那边是页面的真相源，
 * 这边是取景/基线/门岗的。加一屏要同时改两处；只改一处的后果是那屏截不出图或留下孤儿基线，
 * 而 `check-design-lab.mjs` 的「基线 ↔ 注册表一一对应」那一条会把它逼出来。
 *
 * 注册表真身按来源/主题拆在各自的 `states/` 里（单文件 ≤800 行，R12 巨壳门岗）。
 * 解析顺序 = 文件名排序，与汇总口的拼接顺序一一对应（文件名带数字前缀就是为了这个）。
 */
export const LAB_SCREENS = {
  'agent-panel-v4': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/v4/states'),
    baselineDir: path.join(BASELINE_ROOT, 'agent-panel-v4'),
  },
  editing: {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/editing/states'),
    baselineDir: path.join(BASELINE_ROOT, 'editing'),
  },
  storyboard: {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/storyboard/states'),
    baselineDir: path.join(BASELINE_ROOT, 'storyboard'),
  },
  'host-config': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/hostConfig/states'),
    baselineDir: path.join(BASELINE_ROOT, 'host-config'),
  },
  'canvas-add-menu': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/canvasAddMenu/states'),
    baselineDir: path.join(BASELINE_ROOT, 'canvas-add-menu'),
  },
  'canvas-frame': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/canvasFrame/states'),
    baselineDir: path.join(BASELINE_ROOT, 'canvas-frame'),
  },
  settings: {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/settings/states'),
    baselineDir: path.join(BASELINE_ROOT, 'settings'),
  },
  'vendor-order': {
    registryDir: path.join(REPO_ROOT, 'src/devlab/designLab/vendorOrder/states'),
    baselineDir: path.join(BASELINE_ROOT, 'vendor-order'),
  },
}

export const LAB_SCREEN_IDS = Object.keys(LAB_SCREENS)

function screenConfig(screenId) {
  const config = LAB_SCREENS[screenId]
  if (!config) throw new Error(`未知的实验室屏：${screenId}（已登记：${LAB_SCREEN_IDS.join(', ')}）`)
  return config
}

export function baselineDirFor(screenId) {
  return screenConfig(screenId).baselineDir
}

/**
 * 一个 `.tsx` 注册表文件里的**顶层字符串常量**。
 *
 * 为什么要它：整组共用同一句 `source` 时，写 `const SOURCE = '…'` 再 `source: SOURCE` 是
 * 正常的（也是唯一不把同一句话抄六遍的写法）。解析器不认标识符的后果不是报错，是**静默漏项**——
 * 2026-09-06 v4 的 6 张接线格就是这么对门岗隐身的（走查报「活 63 / 解析 57」才逼出来）。
 *
 * 只认同文件顶层（行首 `const`）的单引号字面量：跨文件解析会让 A 文件的常量喂给 B 文件，
 * 而这些文件是被拼起来读的，一个重名就能悄悄换掉另一屏的来源。
 */
function topLevelStringConsts(source) {
  const consts = new Map()
  const re = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/gm
  let match
  while ((match = re.exec(source)) !== null) consts.set(match[1], match[2])
  return consts
}

/**
 * 注册项形如：`id: 'form-06-tool-line',` 紧跟 `name`, `source`, `coverage`；
 * `capture: 'viewport'`（浮层类形态要截整屏）是可选的，出现在 `render` 之前。
 * `source` 可以是字面量，也可以是同文件顶层的 const 标识符。
 *
 * **fail-closed**：认出一条注册项（`id` 紧跟 `name`）却读不全它的元数据，就当场抛，
 * 指名道姓说是哪个 id、哪个文件、缺哪个字段。
 *
 * 这一条是本解析器最重要的性质，不是防御性编程：漏解析在所有下游都长成「本来就没有这个状态」——
 * 少截一张图、少比一条基线、门岗照旧打印「一一对应」。它至今咬过两次，两次都只有走查
 * （活页面 vs 解析结果逐项比对）事后抓到，静态门岗一次都没看见：
 *   · 2026-09-06 `inspector-04-music`：四行之间夹了一段注释（旧正则要求四行严格相邻）。
 *   · 2026-09-06 `v4-wired-*` 六条：`source: SOURCE` 写成了标识符。
 * 两种写法都完全合法，错的一直是解析器。所以正解不是「以后别那么写」，是让读不懂的当场喊。
 */
export function parseLabStateFile(source, fileLabel) {
  const consts = topLevelStringConsts(source)
  // 注册项的入口签名 = `id: '<kebab>',` 换行紧跟 `name: '`。这两行相邻是 LabState 字面量的
  // 结构特征，夹具数据里的 `id:`（`id: 'F_SEG_B'`、`id: \`design-lab:…\`）都不长这样，
  // 所以它既数得全、又不会把夹具误认成状态。
  const entryStart = /\bid:\s*'([a-z0-9-]+)',\s*\n\s*name:\s*'([^']*)'/g
  const found = []
  let match
  while ((match = entryStart.exec(source)) !== null) {
    found.push({ id: match[1], name: match[2], index: match.index })
  }
  return found.map((entry, position) => {
    const next = found[position + 1]?.index ?? source.length
    // 元数据只在 `render` 之前找：render 函数体里也可能出现 `coverage`/`source` 这些词，
    // 越过它去找就是拿渲染代码里的字符串当注册元数据。
    const body = source.slice(entry.index, next)
    const renderAt = body.search(/\brender:/)
    const segment = renderAt < 0 ? body : body.slice(0, renderAt)
    const sourceMatch = /\bsource:\s*(?:'([^']*)'|([A-Za-z_$][\w$]*))/.exec(segment)
    const coverageMatch = /\bcoverage:\s*'([a-z-]+)'/.exec(segment)
    const where = `${fileLabel} 的状态 ${entry.id}`
    if (!sourceMatch) throw new Error(`${where} 没有可解析的 source —— 写成字面量，或写成同文件顶层的 const 字符串`)
    if (!coverageMatch) throw new Error(`${where} 没有可解析的 coverage`)
    const stateSource = sourceMatch[1] ?? consts.get(sourceMatch[2])
    if (stateSource === undefined) {
      throw new Error(`${where} 的 source 引用了标识符 ${sourceMatch[2]}，但同文件顶层没有这个 const 字符串`)
    }
    return {
      id: entry.id,
      name: entry.name,
      source: stateSource,
      coverage: coverageMatch[1],
      capture: /\bcapture:\s*'viewport'/.test(segment) ? 'viewport' : 'element',
    }
  })
}

export function readLabStates(screenId = 'agent-panel') {
  const registryDir = screenConfig(screenId).registryDir
  const files = fs.readdirSync(registryDir).filter((name) => name.endsWith('.tsx')).sort()
  if (!files.length) throw new Error(`${registryDir} 里一个注册表文件都没有`)
  // **逐文件解析再按文件名顺序拼接**，不是先 join 成一大坨再解析：常量表是每个文件自己的，
  // 拼起来读会让 A 文件的 `const SOURCE` 喂给 B 文件里同名的那个。
  const entries = files.flatMap((name) =>
    parseLabStateFile(fs.readFileSync(path.join(registryDir, name), 'utf8'), `${screenId}/${name}`),
  )
  if (!entries.length) {
    throw new Error(`没有从 ${registryDir} 解析出任何状态——注册表格式变了，先修这把正则`)
  }
  const ids = entries.map((entry) => entry.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length) throw new Error(`状态 id 重复：${duplicates.join(', ')}`)
  return entries
}

export function readCalibration() {
  return JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'))
}

/**
 * 「基线待用户拍板」登记表：屏 id → 一句为什么。
 *
 * 这**不是**逃生口。没有获批基线的屏本来就没有可回归的对象——逐像素比一张没人看过的图
 * 只会把「今天长这样」当成「应该长这样」，那才是真的假绿。登记是显式的、写在
 * calibration.json 里、门岗每次都醒目打印，拍板录完基线就必须删掉这一条。
 * 孤儿基线不受登记豁免：图在、状态没了，照红。
 */
export function pendingApprovalScreens() {
  return readCalibration().pendingApprovalScreens ?? {}
}
