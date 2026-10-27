// 界面不印金额（2026-10-27，方向检查 docs/engineering/direction-checks/2026-10-27-ui-money-amounts.md）。
//
// 设计系统的规矩是界面不谈钱：现在都走中转，扣没扣、扣多少 Nomi 证明不了；Run 账本的合计只加已知价，算不出价的镜头
// 不在里面，实付也从不回写——格式化出来的金额要么是零、要么只是已知那部分，读起来都像全额。
// 词典门岗（scripts/check-i18n-no-cost-claims.mjs）按词表扫「免费 / 会花钱」断言，看不见代码里现算的金额：
// 任务中心「制作详情」的四个金额格（标签不含钱字、值由 Intl currency 现算）就是从这条缝里漏的。
//
// 这是 ESLint 一条规则的数据（eslint.config.mjs 以独立规则 id `ui-money/*` 注册，只在两个块里配置）：
// - MONEY_FORMAT_SELECTORS：把金额格式化成上屏文字的写法，按语法树认，不按字面认；
// - MONEY_FORMAT_EXITS：现存还在印金额的文件 → 处数 + 是什么。只减不增：scripts/ui-money-format.test.mjs 用同一组
//   选择器扫全 src，名单外出现一处就红；名单内处数多了红，少了也红（改完把数降下来，或删掉这一行）。
//   名单里每一处都是真金额，不是误报；它们属付费确认卡与 Agent 面板的价格文案，去留由协调另定。
// - FORMAT_MONEY_IMPORTERS：现成的货币格式化函数只许这几处 import——界面层拿不到格式化成货币的函数，
//   就写不出新的金额格。
//
// 看不见的形状（明写的缺口）：不带币种的裸数字（toFixed / 千分位），以及经变量间接传给 t() 的金额。

const MESSAGE = '界面不印金额（设计系统：界面不谈钱）：账本合计只加已知价、实付不回写，格式化出来的金额没有依据。'
  + '不要在界面里把预算 / 价格格式化成货币（Intl currency、货币符号或货币码拼接、词典模板里的货币符号）。'
  + '现存的几处登记在 scripts/ui-money-format.mjs，只减不增。'

/** 货币符号或货币码，紧贴在数字前面那一侧。 */
const MARK_BEFORE = '(?:[¥￥$€£]|\\b(?:USD|CNY|RMB|EUR|JPY|GBP))'
/** 紧贴在数字后面那一侧。不收 `$`：正则拼接（`${x}$`、`'^' + x + '$'`）里的 `$` 是行尾，不是钱。 */
const MARK_AFTER = '(?:[¥￥€£]|(?:USD|CNY|RMB|EUR|JPY|GBP)\\b)'
/** 货币变量：`currency` / `x.currency`（作为属性名时也是一个 Identifier 节点）。 */
const CURRENCY_NAME = '/^currency$/i'

export const MONEY_FORMAT_SELECTORS = Object.freeze([
  // Intl.NumberFormat / toLocaleString 的货币样式（键写不写引号都算）。
  "Property[key.name='style'][value.value='currency']",
  "Property[key.value='style'][value.value='currency']",
  // 模板字符串：货币符号 / 货币码紧贴着插值（`¥${x}`、`CNY ${x}`、`${x} USD`）。
  `TemplateElement[tail=false][value.cooked=/${MARK_BEFORE}\\s*$/]`,
  `TemplateElement:not(:first-child)[value.cooked=/^\\s*${MARK_AFTER}/]`,
  // 模板字符串里出现货币变量（`${currency} ${x.toFixed(2)}`、`${x}${budget.currency}`）。
  `TemplateLiteral Identifier[name=${CURRENCY_NAME}]`,
  // 加号拼接：货币符号 / 货币码 / 货币变量直接参与拼接。
  `BinaryExpression[operator='+'] > Literal.left[value=/${MARK_BEFORE}\\s*$/]`,
  `BinaryExpression[operator='+'] > Literal.right[value=/^\\s*${MARK_AFTER}/]`,
  `BinaryExpression[operator='+'] > Identifier[name=${CURRENCY_NAME}]`,
  `BinaryExpression[operator='+'] > MemberExpression[property.name=${CURRENCY_NAME}]`,
  // JSX：文字里的货币符号 / 货币码紧贴着表达式（`¥{amount}`、`{amount} CNY`）。
  `JSXText[value=/${MARK_BEFORE}\\s*$/] + JSXExpressionContainer`,
  `JSXExpressionContainer + JSXText[value=/^\\s*${MARK_AFTER}/]`,
  // 词典模板：货币符号 / 货币码紧贴着插值占位（`'¥{{amount}}'`、`'USD {{amount}}'`），或占位本身就是币种。
  `Literal[value=/${MARK_BEFORE}\\s*\\{\\{|\\}\\}\\s*${MARK_AFTER}|\\{\\{\\s*currency\\s*\\}\\}/]`,
].map((selector) => Object.freeze({ selector, message: MESSAGE })))

/** 规则管的范围：渲染层源码（测试除外；设计实验室 src/devlab 在全局 ignores 里）。 */
export const UI_MONEY_FILES = Object.freeze(['src/**/*.{ts,tsx}'])
export const UI_MONEY_TEST_FILES = Object.freeze(['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'])

/**
 * 现存还在印金额的文件（2026-10-27 普查冻结，全 src 1632 个文件、名单外 0 处）：文件 → { count: 选择器命中处数, what: 印的是什么 }。
 * 都属付费确认卡与 Agent 面板的价格文案，不在 2026-10-27 那次改动范围里，逐个由协调定去留；定了删的，同提交把这一行删掉。
 */
export const MONEY_FORMAT_EXITS = Object.freeze({
  'src/workbench/ai/v4/formatMoney.ts': Object.freeze({ count: 2, what: 'Agent 面板付费卡逐镜价的货币格式化（Intl currency，失败退回「货币码 + 两位小数」）' }),
  'src/workbench/ai/resident/residentToolDisplay.ts': Object.freeze({ count: 2, what: 'Agent 提案卡的「预估」一行：预估是 { amount, currency } 时拼「货币码 + 金额」' }),
  'src/workbench/generationCanvas/spend/ProductionContractSummary.tsx': Object.freeze({ count: 3, what: '制作合同确认卡的估价区间与硬上限（文件内自带一份货币格式化）' }),
  'src/workbench/capability/generationGateConfirm.ts': Object.freeze({ count: 2, what: 'MCP 生成闸确认框里的单次最高价（货币码直接拼数字）' }),
  'src/workbench/generationCanvas/nodes/ProvenancePanel.tsx': Object.freeze({ count: 1, what: '节点来历面板的实付金额（只在 unit=actual 时出现）' }),
  'src/i18n/locales/generationCommon.ts': Object.freeze({ count: 2, what: '多镜确认卡逐镜价模板 production.batch.shotPrice（中英，币种写死）' }),
  'src/i18n/locales/agentPanelV4.ts': Object.freeze({ count: 2, what: 'Agent 面板模型用量模板 costUsd（中英）' }),
})

/** 现成的货币格式化函数。 */
export const FORMAT_MONEY_MODULE = 'src/workbench/ai/v4/formatMoney.ts'
/**
 * 允许 import 它的文件 → 拿它印什么（同样只减不增，去留随上面的出口名单一起定）。
 * 名单与 src 里真实 import 它的文件逐一相等（scripts/ui-money-format.test.mjs 普查）：不再 import 的同提交删掉放行位。
 * 2026-10-27 删了 Agent 面板任务卡那一位（useAgentPanelV4Data.ts：任务卡不再印金额）。
 */
export const FORMAT_MONEY_IMPORTERS = Object.freeze({
  'src/workbench/ai/v4/agentPanelSpendCard.ts': 'Agent 付费卡的逐镜价',
})
export const FORMAT_MONEY_IMPORT_PATTERN = Object.freeze({
  regex: '(?:^|/)formatMoney(?:\\.ts)?$',
  message: `${MESSAGE}货币格式化函数只许名单里的文件 import（scripts/ui-money-format.mjs 的 FORMAT_MONEY_IMPORTERS）。`,
})
