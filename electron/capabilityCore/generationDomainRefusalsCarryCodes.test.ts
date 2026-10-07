// 生成域里**每一次有意的拒绝都要带码**——这条不变量的机器化持有者（棘轮，只减不增）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 2026-09-21 那轮实测里，23 次失败是「域里写了一句可行动的话，被兜底吃掉换成『提交结果可能未知』」。
// 修完之后 2026-09-22 复跑（run2），**同一个形状又出现 6 次**——只是这次兜底说了实话
// （「draft_shots failed inside Nomi」）。逐条复现拿到的真异常里，5 次是同一句：
// 「没有配置可用的视频/图片模型。请在设置里选一个默认…或者在这次调用里直接点名…」——
// 一句模型改一次就能对的话，住在**第三份**没人管的 `throw new Error(...)` 里。
//
// 一份一份地找是抓不完的：这一族的特征是「不报错、只是少说了一句」。所以判据换成源码级：
// 生成域的文件里出现 `throw new Error(`，要么改成 `refuseToModel(...)`，要么**在下面这张表里
// 写清它为什么不是模型能修的东西**。表只减不增。
//
// ── 判据为什么是源码扫描，不是行为测试 ──
//
// 要证的是「**每一处**抛出点都带码」，这是对一组文件的断言；行为测试只能一条路一条路证，
// 而漏掉的那条恰恰是没人想起来写测试的那条（R17：能让门岗拦的别留给人）。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** 扫描范围：模型可见的生成动词（draft_shots / generate / check_job / cancel_job）会走到的域文件。 */
const SCANNED = [
  'electron/capabilityCore/mcpGenerationTools.ts',
  'electron/capabilityCore/mcpGenerationMultiShot.ts',
  'electron/capabilityCore/mcpGenerationVideoResolve.ts',
  'electron/capabilityCore/semanticGenerationCandidate.ts',
  'electron/capabilityCore/generationTransportAdapters.ts',
]

/**
 * 允许留下的裸 `throw`（棘轮，只减不增）。每一条都要答得出同一个问题：
 * **模型读到这句话能做点什么吗？** 答不出「能」，它就不该带正文出去——只给码，兜底接住。
 */
const NOT_A_MODEL_REFUSAL: ReadonlyMap<string, string> = new Map([
  ['storyboard_renderer_required', '宿主状态：分镜渲染层没接上。模型改不了，也不该知道我们内部接没接上。'],
  ['storyboard_design_save_rejected', '协议收据不符：渲染层回的存盘回执和我们发的对不上。这是我们两侧的账，不是模型的入参。'],
  ['storyboard_presentation_receipt_mismatch', '同上，展示回执那一半。'],
  ['storyboard_reference_preview_unavailable', '宿主状态：参考图预览这一刻拿不到。模型没有可改的字段。'],
  ['A verified project lease is required', '程序员错误：装配时没把租约递进来。模型无从参与。'],
  ['Generation gate decisions must use the Run-owned authorization seam', '程序员错误：走错了授权接缝。这条永远不该被模型触发。'],
  ['Unsupported semantic generation capability', '程序员错误：路由到了一个不存在的能力分支。'],
  ['generation schema has no', '装配期自检：schema 的分支名对不上。宁可装配期炸，也不要静默退回更窄的形状。'],
  ['surface_port_unavailable', '宿主状态：3D-BOX 出卡前预检读候选时，生成面端口已被释放。读它的是宿主自己的 preflightGenerate，它 catch 后换成带码的 director_preview_pending 出去；模型从不直接读到这一句。'],
  ['generation_operation_not_found', '宿主状态：同一条预检读不到这份草稿的镜头列表。同样被 preflightGenerate 的 catch 接住、fail-closed 不出卡，换成带码的 director_preview_pending；模型没有可改的字段。'],
])

function bareThrows(file: string): readonly { line: number; text: string }[] {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
  const found: { line: number; text: string }[] = []
  source.split('\n').forEach((text, index) => {
    if (!text.includes('throw new Error(')) return
    // 带 `code:` 的 `Object.assign(new Error(...), { code })` 不在这一族里——它已经有码了。
    if (text.includes('Object.assign')) return
    found.push({ line: index + 1, text: text.trim() })
  })
  return found
}

const excused = (text: string): boolean => [...NOT_A_MODEL_REFUSAL.keys()].some((reason) => text.includes(reason))

describe('生成域里每一次有意的拒绝都带码', () => {
  // 阳性对照：扫描器认不出任何一处时，下面的断言会「空集通过」，而空集通过和真通过长得一模一样。
  it('扫描器真的认得出它声称要找的形状', () => {
    expect(SCANNED.length).toBeGreaterThan(0)
    for (const file of SCANNED) expect(fs.existsSync(path.join(process.cwd(), file)), `扫描范围里的 ${file} 不在盘上`).toBe(true)
    // 全仓至少还有若干条被豁免的裸抛——一条都扫不到就是扫描器坏了，不是代码干净了。
    expect(SCANNED.flatMap(bareThrows).length).toBeGreaterThan(0)
    expect(excused("throw new Error('storyboard_renderer_required')")).toBe(true)
    expect(excused('throw new Error(`没有配置可用的模型`)')).toBe(false)
  })

  it('没有第四份「没人管的 throw」：不在豁免表里的裸抛一条都不许剩', () => {
    const offenders = SCANNED.flatMap((file) => bareThrows(file).filter((item) => !excused(item.text))
      .map((item) => `${file}:${item.line}  ${item.text}`))
    expect(
      offenders,
      '这一句会被 adapter 的兜底吃掉，模型只会收到一个说不出拒了什么的码。'
        + '改成 refuseToModel(GENERATION_ARGUMENT_REFUSAL, "<模型改一次就能对的话>")；'
        + '如果它本来就不是模型能修的东西，把理由写进 NOT_A_MODEL_REFUSAL。',
    ).toEqual([])
  })

  it('豁免表只减不增：每一条都还在用，修好的那条必须删掉', () => {
    const all = SCANNED.flatMap(bareThrows).map((item) => item.text)
    const stale = [...NOT_A_MODEL_REFUSAL.keys()].filter((reason) => !all.some((text) => text.includes(reason)))
    expect(stale, '这几条豁免已经没有对应的代码了——豁免表不留永久名额，修好就删行').toEqual([])
  })
})

// `look_at_media` 那一格（2026-09-22）：它的失败此前只有一个裸码。带上字段级理由之后，
// 下一轮至少知道是**哪一格**对不上；而「绝不含收到的值」这条要一起守住——
// 参数里可能有用户的文稿正文与素材路径。
describe("媒体/导出这条路的失败也说清是哪一格", () => {
  const adapter = fs.readFileSync(path.join(process.cwd(), 'electron/capabilityCore/phase4SurfaceTransportAdapters.ts'), 'utf8')

  it("两个失败点都走共用的那一个组装处，不再各自返回裸码", () => {
    expect(adapter).toContain('safeTransportFailure')
    expect(adapter, '输入不合法那一格原来是 `catch { return {code, message: code} }`——理由整个丢掉了')
      .not.toContain('return { ok: false, code: "capability_input_invalid", message: "capability_input_invalid" }')
  })

  it("字段级理由只取字段名与期望类型，绝不取收到的值", () => {
    const detail = adapter.slice(adapter.indexOf('function zodFieldDetail'), adapter.indexOf('function safeFailure'))
    expect(detail).toContain('path')
    expect(detail).toContain('expected')
    expect(detail, '一旦这里开始读 `received`，用户的文稿正文就会流到模型那里').not.toContain('received')
  })
})
