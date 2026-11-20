// 参数值只在门口规整一次（方向检查 docs/engineering/direction-checks/2026-11-17-param-value-type.md）的三道保险：
// ① 反例必红、正例必绿：删之前主分支上各处第二个解析器的原文（逐字摘出，放回它们原来的路径）必红；改名、内联、
//    换个袋名的同形写法也红；推荐的文字档筛选、跨字段同值比较、按别的键读元数据这些合法写法必绿；
// ② 全仓普查：只开这一条规则、关掉行内 eslint-disable，扫它管的全部目录，命中只能是 0（名单里的门本身除外）；
//    名单里每个文件都还真有要豁免的转换（不需要了就从名单删）；
// ③ 接线：仓库自己的 eslint 配置在真实路径上报这条规则，测试文件、名单文件、目录外的供应商出口编码不报。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

import {
  PARAM_VALUE_DOOR_EXITS,
  PARAM_VALUE_DOOR_FILES,
  PARAM_VALUE_DOOR_IGNORES,
  PARAM_VALUE_DOOR_RULE_ID,
  paramValueDoorPlugin,
} from './param-value-door-rule.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ruleConfig = (ignores) => ({
  files: [...PARAM_VALUE_DOOR_FILES],
  ignores,
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { 'param-value-door': paramValueDoorPlugin },
  rules: { [PARAM_VALUE_DOOR_RULE_ID]: 'error' },
})
// 只开这一条规则、不认行内 eslint-disable 的计数器：普查数的是真写法，不是有没有人关掉规则。
const counter = new ESLint({ cwd: root, overrideConfigFile: true, allowInlineConfig: false, overrideConfig: ruleConfig([...PARAM_VALUE_DOOR_IGNORES]), errorOnUnmatchedPattern: false })
const exitCounter = new ESLint({ cwd: root, overrideConfigFile: true, allowInlineConfig: false, overrideConfig: ruleConfig([]) })
// 仓库自己的配置：接线核的就是 eslint.config.mjs 里那一块。
const repo = new ESLint({ cwd: root })

async function hits(eslint, source, file) {
  const [result] = await eslint.lintText(source, { filePath: path.join(root, file) })
  const fatal = result.messages.find((message) => message.fatal)
  if (fatal) throw new Error(`${file} 解析失败，规则会漏看：${fatal.message}`)
  return result.messages.filter((message) => message.ruleId === PARAM_VALUE_DOOR_RULE_ID).length
}
const doorHits = (source, file) => hits(counter, source, file)

// ── ① 删之前主分支上的原文（逐字摘出；只补了让片段能单独解析的函数外壳）──
const MAIN_BEFORE = [
  ['分镜行按 typeof 把数字送进 durationSec、字符串送进 params', 'src/workbench/creation/storyboard/shotRow/storyboardComposerModel.ts', `
export function storyboardComposerChange(control, raw, controls) {
  const ratioKey = aspectRatioControlKey(aspectRatioControlsOf(controls.filter(isParameterControl)))
  if (control.key === ratioKey) return { kind: 'aspect', value: raw }
  const value = control.type ? parseControlInput(control as ModelParameterControl, raw) : raw
  if (control.key === 'duration' && typeof value === 'number') return { kind: 'duration', value }
  return { kind: 'param', key: control.key, value }
}`],
  ['档位里按 typeof 挑数字档', 'electron/shared/videoCapabilities/paramConstraints.ts', `
export function numericOptionValues(control: ModelParameterControl): number[] {
  return control.options
    .map((option) => option.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}`],
  ['合法性按字符串形比较', 'electron/shared/videoCapabilities/paramConstraints.ts', `
export function isParamValueAllowed(control: ModelParameterControl, value: string | number | boolean): boolean {
  if (control.options.length > 0) return control.options.some((option) => String(option.value) === String(value));
  return true;
}`],
  ['合法性的数字分支自己 typeof', 'electron/shared/videoCapabilities/paramConstraints.ts', `
export function isParamValueAllowed(control: ModelParameterControl, value: string | number | boolean): boolean {
  if (control.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    return true;
  }
  return true;
}`],
  ['推荐输入按 typeof 读时长（"10" 读不到）', 'electron/capabilityCore/mcpGenerationVideoResolve.ts', `
export function videoRecommendationInput(candidate: PlanCandidate) {
  const parameters = candidate.parameters;
  const durationSeconds = typeof parameters.duration === "number"
    ? parameters.duration
    : typeof parameters.durationSeconds === "number" ? parameters.durationSeconds : undefined;
  return durationSeconds;
}`],
  ['估时按 typeof 读时长', 'electron/capabilityCore/mcpGenerationVideoResolve.ts', `
export function shotDurationSeconds(candidate: Pick<PlanCandidate, "parameters">): number | undefined {
  const parameters = candidate.parameters ?? {};
  if (typeof parameters.duration === "number" && Number.isFinite(parameters.duration) && parameters.duration >= 0) return parameters.duration;
  return undefined;
}`],
  ['外部助手建镜头按 typeof 取时长', 'electron/shared/storyboard/storyboardSubjectAdapter.ts', `
export function createSubject(candidate, authored, common, input) {
  return planShotSchema.parse({durationSec:typeof candidate.parameters.duration === 'number' ? candidate.parameters.duration : 0,anchorIds:[],...authored,...common,shotId:input.shotId,index:0})
}`],
  ['外部助手改镜头按 typeof 取时长', 'electron/shared/storyboard/storyboardSubjectAdapter.ts', `
export function patchSubject(subject, patch, authored) {
  const duration = (patch.parameters as Record<string, unknown> | undefined)?.duration
  return {...subject, ...(authored?.durationSec === undefined && typeof duration === 'number' ? {durationSec:duration} : {})}
}`],
  ['导演台按键遍历自己解析', 'src/workbench/generationCanvas/nodes/director/model/directorPreviewState.ts', `
export function declaredShotDurationSeconds(node: Pick<GenerationCanvasNode, 'meta'> | undefined): number | undefined {
  for (const key of ['duration', 'durationSeconds']) {
    const raw = node?.meta?.[key]
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
    if (Number.isFinite(value) && value > 0) return value
  }
  return undefined
}`],
  ['列表卡只认数字时长', 'src/workbench/generation/list/generationListMediaFacts.ts', `
export function readDurationSeconds(node: GenerationCanvasNode): number | null {
  const meta = node.meta ?? {}
  const audio = readAudioMeta(node).durationSec
  const value = node.kind === 'audio' ? audio : meta.duration
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}`],
  ['旧目录控件默认值自己 Number', 'src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts', `
export function defaultPatchForCatalogControl(control: DynamicCatalogControl): Record<string, unknown> {
  const value = optionDefaultValue(control.options, control.defaultValue)
  if (control.binding === 'durationSeconds') {
    const durationSeconds = Number(value)
    return Number.isFinite(durationSeconds) ? { [control.key]: durationSeconds, durationSeconds, videoDuration: durationSeconds } : {}
  }
  return {}
}`],
  ['旧 durs 档位自己 Number', 'src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts', `
export function buildEffectiveVideoCatalogConfig(meta: unknown) {
  const legacyDurations = readDurationOptions(meta).flatMap((option) => {
    const rawValue = typeof option === 'string' ? option : String(option.value)
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0) return []
    return [{ value: Math.trunc(value), label: typeof option === 'string' ? \`\${Math.trunc(value)}s\` : option.label }]
  })
  const defaultDuration = Number(readDefaultParam(meta, 'duration'))
  return { legacyDurations, defaultDuration }
}`],
  ['镜头摘要按 typeof 印时长', 'src/workbench/creation/storyboard/shotPresentation.ts', `
export function shotPresentation(shot, params) {
  const duration = shot.durationSec ?? params.duration ?? params.duration_seconds
  return typeof duration === 'number' || typeof duration === 'string' ? \`\${duration}s\` : ''
}`],
  ['耗时提示自己 Number', 'src/workbench/generationCanvas/nodes/GenerationTimingHint.tsx', `
export function hint(node, nodes) {
  return localGenerationMedian(nodes, nodeSelectedModelAddress(node.meta), Number(node.meta?.durationSeconds ?? node.meta?.videoDuration))
}`],
]

// ── 同形的改名、内联、换袋名写法 ──
const VARIANTS = [
  ['改名：转换产物换个名字再 typeof', `export const f = (control, raw) => { const picked = parseControlInput(control, raw); const s = picked; return typeof s === 'number' }`],
  ['内联：typeof 直接包转换调用', `export const f = (control, raw) => typeof parseControlInput(control, raw) === 'number'`],
  ['内联：some 里按 typeof 挑数字档', `export const f = (control) => control.options.some((o) => typeof o.value === 'number')`],
  ['改名：档位集合换名后 for-of', `export const f = (control) => { const choices = control.options; for (const c of choices) if (typeof c.value === 'number') return true; return false }`],
  ['改名：档位值数组换名后 filter', `export const f = (control) => { const values = control.options.map((o) => o.value); return values.filter((v) => Number.isFinite(v)) }`],
  ['换袋名：袋先赋给别的变量', `export const f = (candidate) => { const p = candidate.parameters; const d = p.duration; return typeof d === 'number' ? d : 0 }`],
  ['一元加号', `export const f = (params) => +params.duration`],
  ['parseInt 包 String', `export const f = (meta) => parseInt(String(meta.durationSeconds), 10)`],
  ['Number.isFinite 判袋里的值', `export const f = (stored) => Number.isFinite(stored.duration) ? stored.duration : 5`],
  ['按 control.key 读袋再 typeof', `export const f = (control, previousParams) => { const v = previousParams[control.key]; return typeof v === 'string' }`],
  ['和 control 同函数的 value 参数', `export function allowed(control, value) { return typeof value === 'number' }`],
  ['档位值字符串化比较', `export const f = (control, value) => control.options.find((option) => String(option.value) === String(value))`],
  ['袋读时长字符串化比较', `export const f = (meta, other) => String(meta.duration) === String(other)`],
  ['带袋与时长键的读取函数', `export const f = (meta) => Number(readParam(meta, 'duration'))`],
]

// 同一个调用目标的等价语法；String 仍只在两边字符串化比较时受管。
const CALL_SHAPES = [
  ['直接', (fn) => `${fn}(VALUE)`],
  ['globalThis', (fn) => `globalThis.${fn}(VALUE)`],
  ['window', (fn) => `window.${fn}(VALUE)`],
  ['self', (fn) => `self.${fn}(VALUE)`],
  ['call', (fn) => `${fn}.call(undefined, VALUE)`],
  ['apply', (fn) => `${fn}.apply(undefined, [VALUE])`],
  ['Reflect.apply', (fn) => `Reflect.apply(${fn}, undefined, [VALUE])`],
  ['全局对象和call组合', (fn) => `globalThis.${fn}.call(undefined, VALUE)`],
  ['全局对象和apply组合', (fn) => `window.${fn}.apply(undefined, [VALUE])`],
  ['全局对象和Reflect组合', (fn) => `Reflect.apply(self.${fn}, undefined, [VALUE])`],
  ['计算属性与可选调用', (fn) => `globalThis[${JSON.stringify(fn.split('.')[0])}]${fn.includes('.') ? `.${fn.split('.')[1]}` : ''}?.(VALUE)`],
]
const CONVERSION_VARIANTS = ['Number', 'parseInt', 'parseFloat', 'isFinite', 'isNaN',
  'Number.parseInt', 'Number.parseFloat', 'Number.isFinite', 'Number.isInteger', 'Number.isNaN', 'Number.isSafeInteger']
  .flatMap((fn) => CALL_SHAPES.map(([shape, call]) => [`${fn} ${shape}`, call(fn)]))
const STRING_VARIANTS = CALL_SHAPES.map(([shape, call]) => [`String比较 ${shape}`, `${call('String')} === String(other)`])
const INVOCATION_VARIANTS = [...CONVERSION_VARIANTS, ...STRING_VARIANTS]

// ── 合法写法：必须不红 ──
const GREEN = [
  ['推荐：创作者目标的时长是外部输入（recommendation 原文）', 'electron/shared/videoCapabilities/recommendation.ts', `
const chooseParamValue = (control: ModelParameterControl, input: VideoGenerationRecommendationInput) => {
  const requestedDuration = input.goals?.durationSeconds;
  if (control.key === "duration" && typeof requestedDuration === "number" && Number.isFinite(requestedDuration)) return requestedDuration;
  return undefined;
};`],
  ['推荐：按文字挑分辨率档（recommendation 原文）', 'electron/shared/videoCapabilities/recommendation.ts', `
export const f = (control: ModelParameterControl) => control.options.map((option) => option.value).filter((value): value is string => typeof value === "string");`],
  ['跨字段同值比较：比的是已编码的报文值（crossFieldConstraints 原文）', 'electron/shared/videoCapabilities/crossFieldConstraints.ts', `
const sameValue = (a: unknown, b: unknown) => String(a) === String(b);
export { sameValue };`],
  ['按常量下标读元数据文字（anchorBible 原文）', 'electron/capabilityCore/anchorBible.ts', `
export function anchorStaticFeatures(node) {
  const meta = metaOf(node)
  const staticFeatures = meta?.[ANCHOR_META_KEYS.staticFeatures]
  if (typeof staticFeatures === 'string' && staticFeatures.trim()) return staticFeatures.trim()
  return ''
}`],
  ['按变量下标读模型名（spendConfirm 原文）', 'src/workbench/generationCanvas/spend/spendConfirm.ts', `
export function f(node) {
  const meta = node?.meta || {}
  const read = (key: string): string => typeof meta[key] === 'string' ? String(meta[key]).trim() : ''
  return read('modelVendor')
}`],
  ['控件自己的范围字段', 'electron/shared/videoCapabilities/recommendation.ts', `export const f = (control) => typeof control.min === "number" ? control.min : 0`],
  ['经门读秒数', 'src/workbench/generation/list/generationListMediaFacts.ts', `export const f = (meta) => { const s = paramSeconds(meta); return s !== undefined && s > 0 ? s : null }`],
  ['经门判有限数', 'electron/shared/videoCapabilities/paramConstraints.ts', `export function allowed(control, value) { return isFiniteNumber(value) && value >= (control.min ?? -Infinity) }`],
  ['分镜计划的 durationSec 是 schema 定好的数字', 'src/workbench/creation/storyboard/exec/storyboardProjection.ts', `export const f = (shot) => Number.isFinite(shot.durationSec) && shot.durationSec > 0`],
]

describe('写法：门里自己转参数值必红', () => {
  for (const [name, file, source] of MAIN_BEFORE) {
    it(`主分支原文红：${name}（${file}）`, async () => {
      expect(await doorHits(source, file)).toBeGreaterThan(0)
    })
  }
  for (const [name, source] of VARIANTS) {
    it(`同形写法红：${name}`, async () => {
      expect(await doorHits(source, 'src/workbench/generationCanvas/nodes/paramDoorProbe.ts')).toBeGreaterThan(0)
    })
  }
})

describe('写法：合法写法必绿', () => {
  for (const [name, file, source] of GREEN) {
    it(`绿：${name}`, async () => {
      expect(await doorHits(source, file)).toBe(0)
    })
  }
})

describe('等价调用：参数值红，非参数输入与门外编码绿', () => {
  for (const [name, expression] of INVOCATION_VARIANTS) {
    const source = (value) => `export const f = (meta, input, other) => ${expression.replaceAll('VALUE', value)}`
    it(`门内再转换红：${name}`, async () => {
      expect(await doorHits(source('meta.duration'), 'src/workbench/generation/list/generationListMediaFacts.ts')).toBeGreaterThan(0)
    })
    it(`同目录外部目标绿：${name}`, async () => {
      expect(await doorHits(source('input.goals.durationSeconds'), 'electron/shared/videoCapabilities/recommendation.ts')).toBe(0)
    })
    it(`门外供应商编码绿：${name}`, async () => {
      expect(await hits(repo, source('meta.duration'), 'electron/catalog/paramTranslate.ts')).toBe(0)
    })
  }
  for (const expression of ['Number.call(meta.duration, input.goals.durationSeconds)',
    'Number.apply(meta.duration, [input.goals.durationSeconds])',
    'Reflect.apply(Number, meta.duration, [input.goals.durationSeconds])']) {
    it(`thisArg不是参数值实参：${expression}`, async () => {
      expect(await doorHits(`export const f = (meta, input) => ${expression}`, 'electron/shared/videoCapabilities/recommendation.ts')).toBe(0)
    })
  }
  it('对象上同名的转换方法不是全局转换', async () => {
    expect(await doorHits('export const f = (meta, codec) => codec.Number.call(undefined, meta.duration)', 'src/workbench/generation/list/generationListMediaFacts.ts')).toBe(0)
  })
})

describe('普查：规则管的目录里一处第二个解析器都没有', () => {
  it('只开这条规则、不认行内 eslint-disable，扫全部管辖目录：命中 0', async () => {
    const results = await counter.lintFiles([...PARAM_VALUE_DOOR_FILES])
    const fatal = results.flatMap((result) => result.messages.filter((message) => message.fatal).map((message) => `${path.relative(root, result.filePath)}: ${message.message}`))
    expect(fatal).toEqual([])
    expect(results.length).toBeGreaterThan(1000)
    const found = results.flatMap((result) => result.messages
      .filter((message) => message.ruleId === PARAM_VALUE_DOOR_RULE_ID)
      .map((message) => `${path.relative(root, result.filePath)}:${message.line}`))
    expect(found).toEqual([])
  }, 180_000) // 扫一千多个文件；推送前钩子并发跑时 30 秒不够（同类全仓 lint 的测试也是 120～180 秒）

  for (const file of Object.keys(PARAM_VALUE_DOOR_EXITS)) {
    it(`名单里的 ${file} 还真有要豁免的转换（没有就从名单删）`, async () => {
      expect(await hits(exitCounter, fs.readFileSync(path.join(root, file), 'utf8'), file)).toBeGreaterThan(0)
    })
  }
})

describe('接线：仓库 eslint 配置在真实路径上报，名单 / 测试 / 目录外不报', () => {
  const [, file, source] = MAIN_BEFORE[0]
  it('分镜行原文放回原路径：仓库配置报这条规则', async () => {
    expect(await hits(repo, source, file)).toBeGreaterThan(0)
  })
  it('同一段放进测试文件：不报', async () => {
    expect(await hits(repo, source, file.replace(/\.ts$/, '.test.ts'))).toBe(0)
  })
  it('同一段放进名单里的外部输入解析文件：不报', async () => {
    expect(await hits(repo, source, 'electron/shared/agentCapabilities/verbs/writeVerbs.ts')).toBe(0)
  })
  it('供应商出口编码（目录外）：不报', async () => {
    expect(await hits(repo, `export const f = (params) => typeof params.duration === 'number' ? String(params.duration) : params.duration`, 'electron/catalog/paramTranslate.ts')).toBe(0)
  })
})
