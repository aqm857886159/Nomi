// 形态契约断言器（2026-09-03）——**意图层与自动层共用的唯一入口**。
//
// 为什么需要它（根因结论，见 docs/plan/2026-09-03-design-conformance.md）：
//   拍板样张是 HTML、实现是 React，两套代码描述同一个东西，中间靠人脑翻译 → **漂移是结构性的**。
//   而规格在「形态 / 位置」维度上是散文，**散文在歧义处必然滑向实现成本最低的那个解释**。
//   实证：分镜表 v5 C 段，样张的骨架段是提示词文本内的虚线段，实现做成了框下一行胶囊——
//   功能语义全对、36 门全绿、走查图也拍了，没有任何机器信号能发现「位置错了」。
//
// 本模块把「形态意图」变成二值断言：跑得过 / 跑不过，没有解释空间。
//
// 两层契约、一个断言器（P1 无并行版）：
//   · **意图层**（`*.intent.mjs`，拍板方手写）：机器扫不出哪些关系承载意图，只有拍板那刻的人知道。
//     必须由拍板方写，不能由实现方写——否则等于自己给自己出考卷。
//   · **自动层**（`*.auto.mjs`，从样张导出）：挂点全不全、几何有没有跑偏、token 有没有漂。
//   两者格式相同、目录相同、门岗相同，只有 `layer` 字段与产出方式不同。
//
// 几何断言只做**数量级**，不做像素（纯结构抓不住「看着就不对」，纯像素会被字体/数据差异刷成假红）：
// 容差 = max(一个 token 步进, 期望值 × 数量级比)。28px 做成 200px、340px 做成 500px 会红；
// 56px 渲染成 58px 不会。

import { DEFAULT_TIMEOUT_MS } from './_assert.mjs'

/** 间距 token 步进（tailwind.config.ts spacing 为 4 的倍数）。几何容差的下限。 */
export const TOKEN_STEP_PX = 4
/** 数量级容差比。低于它的偏差属渲染差异，高于它属形态错误。 */
export const MAGNITUDE_RATIO = 0.25

function toleranceFor(expected) {
  return Math.max(TOKEN_STEP_PX, Math.abs(expected) * MAGNITUDE_RATIO)
}

/** 失败输出统一格式：指名道姓——哪个元素、期望什么、实测什么、差多少。禁止「不一致」这种无法行动的报错。 */
function fail(contract, rule, expected, actual, hint) {
  const lines = [
    `形态契约不符 · ${contract.surface} · ${rule.name}`,
    `   期望：${expected}`,
    `   实测：${actual}`,
  ]
  if (hint) lines.push(`   线索：${hint}`)
  lines.push(`   样张：${contract.mockup}`)
  lines.push(`   契约：${contract.__file || `${contract.surface}.${contract.layer}.mjs`}`)
  return lines.join('\n')
}

async function describeParentChain(scope, selector) {
  return scope.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return '（页面上找不到该元素）'
    const chain = []
    for (let n = el.parentElement; n && chain.length < 6; n = n.parentElement) {
      const cls = String(n.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      chain.push(cls ? `${n.tagName.toLowerCase()}.${cls}` : n.tagName.toLowerCase())
    }
    return chain.join(' < ') || '（无父级）'
  }, selector)
}

/** 结构关系：descendant 必须落在 ancestor 内部。这是「骨架段必须长在提示词框里」那一类。 */
async function checkContainment(scope, contract, rule, failures) {
  const total = await scope.locator(rule.descendant).count()
  const inside = await scope.locator(`${rule.ancestor} ${rule.descendant}`).count()
  const min = rule.minCount ?? 1
  if (total < min) {
    failures.push(fail(contract, rule,
      `页面上至少有 ${min} 个 ${rule.descendant}`,
      `只找到 ${total} 个`,
      '选择器写错，或该形态根本没实现'))
    return
  }
  if (inside < min) {
    const chain = await describeParentChain(scope, rule.descendant)
    failures.push(fail(contract, rule,
      `${rule.descendant} 必须是 ${rule.ancestor} 的后代（至少 ${min} 个）`,
      `找到 ${total} 个 ${rule.descendant}，但其中 ${inside} 个在 ${rule.ancestor} 内`,
      `第一个的实际父链：${chain}`))
  }
}

/** DOM 顺序：before 必须排在 after 前面。用于「三块顺序：画面格 → 参考区 → 提示词块」。 */
async function checkOrder(scope, contract, rule, failures) {
  const verdict = await scope.evaluate(({ a, b }) => {
    const ea = document.querySelector(a)
    const eb = document.querySelector(b)
    if (!ea) return { err: `找不到 ${a}` }
    if (!eb) return { err: `找不到 ${b}` }
    const pos = ea.compareDocumentPosition(eb)
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return { ok: true }
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return { ok: false, why: '顺序颠倒' }
    return { ok: false, why: '两者存在包含关系，无法比较先后' }
  }, { a: rule.before, b: rule.after })
  if (verdict.err) {
    failures.push(fail(contract, rule, `${rule.before} 排在 ${rule.after} 之前`, verdict.err))
  } else if (!verdict.ok) {
    failures.push(fail(contract, rule, `${rule.before} 排在 ${rule.after} 之前`, verdict.why))
  }
}

/** 默认不可见：悬停/展开才出现的东西不许常驻（§1.5 情境控件不许挤常驻位）。 */
async function checkHiddenByDefault(scope, contract, rule, failures) {
  const visible = await scope.locator(rule.selector).filter({ visible: true }).count().catch(() => 0)
  if (visible > 0) {
    failures.push(fail(contract, rule,
      `${rule.selector} 默认不可见（悬停/展开才出现）`,
      `默认状态下有 ${visible} 个可见`,
      '常驻会永久占视觉预算，并挤掉内容'))
  }
}

/** 数量级几何：抓「细条做成大板」这类，不抓 ±2px。 */
async function checkMagnitude(scope, contract, rule, failures) {
  const box = await scope.locator(rule.selector).first().boundingBox().catch(() => null)
  if (!box) {
    failures.push(fail(contract, rule, `${rule.selector} 可见且可测量`, '找不到该元素或它不可见'))
    return
  }
  const actual = rule.dimension === 'height' ? box.height : box.width
  const tol = rule.tolerance ?? toleranceFor(rule.expected)
  const delta = actual - rule.expected
  if (Math.abs(delta) > tol) {
    const times = rule.expected ? (actual / rule.expected).toFixed(2) : '∞'
    failures.push(fail(contract, rule,
      `${rule.selector} 的 ${rule.dimension} ≈ ${rule.expected}px（容差 ±${Math.round(tol)}px = max(${TOKEN_STEP_PX}px 步进, ${MAGNITUDE_RATIO * 100}%)）`,
      `${Math.round(actual)}px —— ${delta > 0 ? '超出' : '不足'} ${Math.abs(Math.round(delta))}px，为期望的 ${times} 倍`))
  }
}

/** 相对大小：A 必须明显大于 B（「图是主角」这类主次关系）。 */
async function checkLargerThan(scope, contract, rule, failures) {
  const a = await scope.locator(rule.selector).first().boundingBox().catch(() => null)
  const b = await scope.locator(rule.largerThan).first().boundingBox().catch(() => null)
  if (!a || !b) {
    failures.push(fail(contract, rule, `${rule.selector} 与 ${rule.largerThan} 均可测量`,
      `${!a ? rule.selector : rule.largerThan} 找不到或不可见`))
    return
  }
  const dim = rule.dimension === 'height' ? 'height' : 'width'
  if (a[dim] <= b[dim]) {
    failures.push(fail(contract, rule,
      `${rule.selector} 的 ${dim} 大于 ${rule.largerThan}`,
      `${Math.round(a[dim])}px vs ${Math.round(b[dim])}px —— 主次颠倒`))
  }
}

const HANDLERS = {
  containment: checkContainment,
  order: checkOrder,
  hiddenByDefault: checkHiddenByDefault,
  magnitude: checkMagnitude,
  largerThan: checkLargerThan,
}

function kindOf(rule) {
  if (rule.ancestor && rule.descendant) return 'containment'
  if (rule.before && rule.after) return 'order'
  if (rule.hiddenByDefault) return 'hiddenByDefault'
  if (rule.largerThan) return 'largerThan'
  if (typeof rule.expected === 'number') return 'magnitude'
  return null
}

/**
 * 跑一份形态契约。**一次跑完全部规则再抛**——让人一眼看全所有偏离，而不是修一条跑一次。
 *
 * @param scope  Playwright Page（或已 scope 的 Locator 的 page）
 * @param contract  契约对象（`docs/design/mockups/contracts/*.{intent,auto}.mjs` 的默认导出）
 */
export async function assertMockupContract(scope, contract, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const rules = [...(contract.structure ?? []), ...(contract.geometry ?? [])]
  if (!rules.length) throw new Error(`契约 ${contract.surface} 里一条规则都没有——空契约等于没有契约`)
  const failures = []
  for (const rule of rules) {
    const kind = kindOf(rule)
    if (!kind) {
      failures.push(`契约规则「${rule.name}」形状不合法：既不是包含/顺序/默认隐藏，也不是几何断言`)
      continue
    }
    await HANDLERS[kind](scope, contract, rule, failures)
  }
  if (failures.length) {
    throw new Error(`\n✖ ${contract.surface} 形态契约 ${failures.length}/${rules.length} 条不符：\n\n${failures.join('\n\n')}\n`)
  }
  console.log(`  ✓ 形态契约 ${contract.surface}（${contract.layer}）${rules.length} 条全符`)
  return rules.length
}
