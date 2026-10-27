// 聚焦输入框只经它的主人（2026-10-27，方向检查 docs/engineering/direction-checks/2026-10-27-focus-by-tag-lookup.md）。
//
// ⌘J 打开 Agent 后焦点留在 BODY：外壳按标签名在页面里找 `#project-agent-resident textarea` 再聚焦，10-12 输入框换成
// TipTap（contenteditable）之后页里没有 textarea，找不到就什么也不做。类型系统看不见字符串选择器，五扇入口静默失效 15 天。
// 这一类的形状：调用方按输入框**当时的实现**（标签名 input / textarea / select，或编辑器的 [contenteditable] /
// .ProseMirror / .tiptap）在 DOM 里找它，再 .focus()。
//
// 该怎么写：
// - 别人的输入框：让主人给入口（ref、编辑器实例、或像 src/workbench/ai/residentComposerFocus.ts 那样的请求），不去找；
// - 「一个区域里第一个能聚焦的控件」：tabbable(container)[0]，不手写标签列表；
// - 按主人自己声明的 data 属性、ARIA role 找不在此列。
//
// 这是 ESLint 一条规则的数据（eslint.config.mjs 以独立规则 id `focus-owner/no-restricted-syntax` 注册，渲染层与走查各一个块、范围不重叠）：
// - FOCUS_BY_INPUT_IMPL_SELECTORS：三种写法——查询结果直接链上 .focus()；强转 / 非空断言 / 下标之后再 .focus()；
//   在一个调用了 .focus() 的函数里把这种查询结果存进变量。按语法树认，不按字面认。
// - FOCUS_BY_INPUT_IMPL_EXITS：现存的文件 → 处数 + 是什么。只减不增：scripts/focus-by-tag-lookup.test.mjs 用同一组选择器
//   扫全 src，名单外出现一处就红；名单内处数多了红，少了也红（改完把数降下来，或删掉这一行）。
// - WALK_FOCUS_BY_TAG_SELECTORS：走查侧（tests/ux、evals）判焦点、认输入框不按标签名；现存 0 处，没有名单。
//
// 有意接受的缺口（静态看不出，或拦了会误伤）：closest() 的结果先存进变量再聚焦（closest 进变量多半是判断事件来自哪类控件）；
// 选择器字符串先放进变量再传；经别的函数间接返回再聚焦。

const MESSAGE = '不要按输入框的实现（标签名 input / textarea / select，或 [contenteditable] / .ProseMirror / .tiptap）在页面里找它再聚焦：'
  + '实现一换就找不到，而且静默（⌘J 打开 Agent 后焦点留在 BODY 就是这么来的）。'
  + '别人的输入框让主人给入口（ref、编辑器实例、src/workbench/ai/residentComposerFocus.ts 那样的请求）；'
  + '「区域里第一个能聚焦的控件」用 tabbable(container)[0]。见 scripts/focus-by-tag-lookup.mjs。'

const FOCUS_CALL = "CallExpression[callee.property.name='focus']"
/** 链上 .focus() 时：查询方法都算。 */
const QUERY_CALLS = '/^(?:querySelector|querySelectorAll|closest|getElementsByTagName)$/'
/** 存进变量时不算 closest（见文件头的缺口）。 */
const STORED_QUERY_CALLS = '/^(?:querySelector|querySelectorAll|getElementsByTagName)$/'
/**
 * 选择器里点名了输入框的实现：独立的类型选择器 input / textarea / select（不是 [data-input]、.input-row、#input、
 * [data-v4-control="input"]），或编辑器 DOM（[contenteditable]、.ProseMirror、.tiptap）。标签名不分大小写。
 */
const INPUT_IMPL = '/(?:^|[\\s,>+~(])(?:input|textarea|select)(?![\\w-])|\\[\\s*contenteditable|\\.(?:ProseMirror|tiptap)(?![\\w-])/i'

const SHAPES = [
  // ① 查询结果直接链上 .focus()：x.querySelector('input')?.focus()
  `${FOCUS_CALL} > MemberExpression.callee > CallExpression.object[callee.property.name=${QUERY_CALLS}]`,
  // ② 强转 / 非空断言 / 下标之后再 .focus()：(x.querySelector('textarea') as HTMLElement).focus()、x.querySelectorAll('input')[0].focus()
  `${FOCUS_CALL} > MemberExpression.callee > :matches(TSAsExpression, TSNonNullExpression, MemberExpression[computed=true]).object > CallExpression[callee.property.name=${QUERY_CALLS}]`,
  // ③ 在调用了 .focus() 的函数里把这种查询结果存进变量：const input = document.querySelector('#x textarea'); input?.focus()
  // （已经是 ① 那种直接链上 .focus() 的不在这里重复报。）
  `:function:has(${FOCUS_CALL}) VariableDeclarator CallExpression[callee.property.name=${STORED_QUERY_CALLS}]:not(${FOCUS_CALL} > MemberExpression.callee > CallExpression.object)`,
]
/** 选择器是第一个参数：字符串字面量，或模板字符串里的某一段。 */
const SELECTOR_ARGUMENTS = [
  `> Literal.arguments:first-child[value=${INPUT_IMPL}]`,
  `> TemplateLiteral.arguments:first-child > TemplateElement[value.cooked=${INPUT_IMPL}]`,
]

export const FOCUS_BY_INPUT_IMPL_SELECTORS = Object.freeze(
  SHAPES.flatMap((shape) => SELECTOR_ARGUMENTS.map((argument) => Object.freeze({ selector: `${shape} ${argument}`, message: MESSAGE }))),
)

/** 规则管的范围：渲染层源码（测试除外；设计实验室 src/devlab 在全局 ignores 里）。 */
export const FOCUS_LOOKUP_FILES = Object.freeze(['src/**/*.{ts,tsx}'])
export const FOCUS_LOOKUP_TEST_FILES = Object.freeze(['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'])

// ── 走查侧（tests/ux、evals）：判焦点、认输入框不按标签名 ──
// shell-redesign 走查判 ⌘J 后焦点在不在 Agent 输入框，写的是 activeElement.tagName === 'TEXTAREA'：输入框换成富文本编辑器后
// 这句永远不成立，夜跑从那天起每晚红，红在一百多条红里没人认出产品里焦点确实没进去。按标签名判，输入框一换形态就同时造假红和假绿。
// 走查侧现存 0 处，没有名单；判焦点走 tests/ux/agent-runtime-walk-support.mjs 的 expectComposerFocused()，别的控件用 toBeFocused()。
const WALK_MESSAGE = '走查不按标签名认输入框、判焦点（tagName === \'TEXTAREA\'、instanceof HTMLInputElement、activeElement.matches(\'textarea\')）：'
  + '输入框一换形态就同时造假红和假绿。Agent 输入框用 tests/ux/agent-runtime-walk-support.mjs 的 expectComposerFocused() / composerText()，'
  + '别的控件用 expect(locator).toBeFocused()。见 scripts/focus-by-tag-lookup.mjs。'
const INPUT_TAG = '/^(?:textarea|input|select)$/i'
/** 选择器字符串里点名了 input / textarea / select（不含 [data-…="input"]、.input-row 这类）。 */
const TAG_IN_SELECTOR = '/(?:^|[\\s,>+~(])(?:input|textarea|select)(?![\\w-])/i'
const TAG_PROPERTY = 'MemberExpression[property.name=/^(?:tagName|nodeName|localName)$/]'
const ACTIVE_MATCH_CALL = "CallExpression[callee.property.name=/^(?:matches|closest)$/]:has(MemberExpression[property.name='activeElement'])"

export const WALK_FOCUS_BY_TAG_SELECTORS = Object.freeze([
  // el.tagName === 'TEXTAREA'、'INPUT' !== el?.nodeName、el.tagName.toLowerCase() === 'textarea'
  `BinaryExpression[operator=/^[!=]==?$/]:has(${TAG_PROPERTY}):has(Literal[value=${INPUT_TAG}])`,
  // el instanceof HTMLTextAreaElement / window.HTMLInputElement
  "BinaryExpression[operator='instanceof'][right.name=/^HTML(?:TextArea|Input|Select)Element$/]",
  "BinaryExpression[operator='instanceof'][right.property.name=/^HTML(?:TextArea|Input|Select)Element$/]",
  // document.activeElement?.matches('textarea')、activeElement.closest('form')?.matches(`#${id} select`)
  `${ACTIVE_MATCH_CALL} > Literal.arguments:first-child[value=${TAG_IN_SELECTOR}]`,
  `${ACTIVE_MATCH_CALL} > TemplateLiteral.arguments:first-child > TemplateElement[value.cooked=${TAG_IN_SELECTOR}]`,
].map((selector) => Object.freeze({ selector, message: WALK_MESSAGE })))

/** 走查侧规则管的范围（同 eslint.config.mjs 里 Playwright 那几条：这两片 2026-10-22 起进 ESLint）。 */
export const WALK_FOCUS_FILES = Object.freeze(['tests/ux', 'evals'].map((dir) => `${dir}/**/*.{js,mjs,cjs,ts,tsx,mts,cts}`))

/**
 * 现存的文件（2026-10-27 普查冻结，全 src 1638 个文件、名单外 0 处）：文件 → { count: 选择器命中处数, what: 找的是什么 }。
 * 两处都按 PromptEditor 内部的 contenteditable 找分镜行的提示词框，现在能用；两个文件都是 14 天第 3–4 个 fix 的热点，
 * 迁成「行自己持有的编辑器实例」要另做方向检查，交协调另排。迁完同提交把这一行删掉。
 */
export const FOCUS_BY_INPUT_IMPL_EXITS = Object.freeze({
  'src/workbench/creation/storyboard/StoryboardShotTable.tsx': Object.freeze({ count: 1, what: '定位到某一镜后把光标放进那一行的提示词框：row.querySelector(\'[data-prompt-box] [contenteditable="true"]\')' }),
  'src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx': Object.freeze({ count: 1, what: '行上按 Enter 进提示词框：querySelector(\'[data-prompt-box="true"] [contenteditable="true"]\')' }),
})
