// 「这个 JSX 元素是不是一个控件、它挂的动作是哪个 i18n key」—— 两道门岗共用的判据。
//
// 为什么抽出来：`check:icon-semantics`（一个动作一个图标）和 `check:controls` 规则四~六
// （控件文案契约）问的是同一个前置问题。各留一份必然漂：一边把 `MenuItem` 算控件、
// 另一边不算，两道门岗就会对同一颗按钮给出互相矛盾的结论。
import ts from 'typescript'

/**
 * 是不是一个真实控件。
 *
 * ⚠️ 刻意**不**把「有 onClick」当控件：`role="dialog"` 的弹层容器普遍写
 * `onClick={(e) => e.stopPropagation()}`，一旦算它，容器的 aria-label 会被安到里面
 * 所有图标头上（实测 TimelineTransitionPicker 因此假红）。要判就判可访问性角色。
 */
export function isControlTag(tagName, attrs) {
  if (tagName === 'button' || tagName === 'a') return true
  if (/(Button|IconBtn|Btn|MenuItem|Tab)$/.test(tagName)) return true
  if (!attrs) return false
  return attrs.properties.some((attr) => {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'role' || !attr.initializer) return false
    return ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'button'
  })
}

export const jsxTagOf = (node) =>
  ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : node.openingElement.tagName.getText()

export const jsxAttrsOf = (node) =>
  ts.isJsxSelfClosingElement(node) ? node.attributes : node.openingElement?.attributes

/**
 * `t('a.b.c')` / `desktopT('a.b', {..})` → `'a.b.c'`；不是这个形状就 null。
 * 三元里取不到唯一 key（`cond ? t(a) : t(b)`）——调用方各自决定怎么处理。
 */
export function i18nKeyOf(node) {
  let expr = node
  if (expr && ts.isJsxExpression(expr)) expr = expr.expression
  if (!expr || !ts.isCallExpression(expr)) return null
  const callee = expr.expression
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  if (name !== 't' && name !== 'desktopT') return null
  const first = expr.arguments[0]
  return first && ts.isStringLiteral(first) ? first.text : null
}
