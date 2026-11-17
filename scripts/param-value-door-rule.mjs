// 参数值只在门口规整一次（2026-11-17，方向检查 docs/engineering/direction-checks/2026-11-17-param-value-type.md）。
//
// 时长这类参数有两种写法（数字 5 / 字符串 "5"），过去每个读它的地方各自 typeof / Number / 字符串化比较一遍：
// 分镜行按 typeof 把数字送进 durationSec、字符串送进 params，两条路互相覆盖，选了 12 秒发出去却是 5 秒。
// 现在声明门、值门、出口编码都住 electron/shared/videoCapabilities/paramValue.ts；门里再自己转一次，就是第二个解析器。
//
// 这是 ESLint 一条自写规则（eslint.config.mjs 以 `param-value-door/no-reparse` 注册，只在一个块里配置）。
// 「这个变量是不是来自参数袋 / 控件档位」是领域判断，现成的 no-restricted-syntax 选择器写不出「变量从哪来」，所以自写
// （登记见 docs/engineering/self-written.json）。按语法树认，不按字面认：
//
// 动作（四种转换）：`typeof X === "number" | "string"`、`Number / parseInt / parseFloat / Number.isFinite / isFinite(X)`、
//   一元 `+X`、`String(X) === String(Y)`（任一侧来自来源即算）。
// 来源：
//   ① 参数袋读时长：袋名（parameters / params / meta / extras / stored / previousParams / paramMap / patch.parameters /
//      x.meta 这类）上读 `.duration` / `.durationSeconds`、按参数键下标读袋（遍历时长键的循环变量、`control.key`），
//      或带袋又带 'duration' 字面量的调用（`readDefaultParam(meta, 'duration')`）；按别的下标读袋（模型名、网址）不是参数值，不管；
//   ② 档位值：控件档位集合（`xxx.options`、`xxxOptions`、`readXxxOptions(...)`、它们链式 map / filter 的结果）迭代回调的参数、
//      for-of 的循环变量，以及它们的 `.value`。档位值只拦 `typeof … === "number"`（按数字挑档就是第二个解析器）；
//      按 `"string"` 挑文字档（分辨率 draft / final）是合法的，不拦；
//   ③ 界面输入转换函数的产物：`parseControlInput / declaredOptionValue / optionDefaultValue / optionValue(...)`；
//   ④ 和 `control` 同一个函数的参数里叫 `value / raw / rawValue` 的那个（判「这个值合不合这个控件」）。
//   变量：初始化式是上面任一来源（经条件、逻辑、可选链、as、非空断言、String / Number / .trim() 包一层都算），改名照样追。
//
// 看不见的形状（明写的缺口）：解构改名（`const { duration: d } = params`）、跨函数传参、duration 以外的键、
//   自己包一层 `const str = (v) => String(v)` 再比。
//
// 名单只放门本身和外部输入解析（逐个写理由）；不在本规则目录范围里的供应商出口编码天然不受管。

export const PARAM_VALUE_DOOR_RULE_ID = 'param-value-door/no-reparse'

const MESSAGE = '参数值只在门口规整一次：门里不要自己 typeof / Number / 字符串化比较参数值（那是第二个解析器，分镜行选 12 秒发出 5 秒就是这么来的）。'
  + '读秒数用 paramSeconds，外来值进门用 admitParamValue / admitNumber，判「是不是有限数」用 isFiniteNumber，档位数字用 declaredNumericOptions'
  + '（都在 electron/shared/videoCapabilities/paramValue.ts）。'

/** 规则管的目录：参数从这些地方进出画布、分镜、助手与发送。 */
export const PARAM_VALUE_DOOR_FILES = Object.freeze([
  'electron/shared/videoCapabilities/**/*.{ts,tsx}',
  'electron/shared/modelArchetypes/**/*.{ts,tsx}',
  'electron/shared/storyboard/**/*.{ts,tsx}',
  'electron/shared/agentCapabilities/**/*.{ts,tsx}',
  'electron/capabilityCore/**/*.{ts,tsx}',
  'src/workbench/creation/storyboard/**/*.{ts,tsx}',
  'src/workbench/generationCanvas/**/*.{ts,tsx}',
  'src/workbench/generation/list/**/*.{ts,tsx}',
])

/**
 * 名单：文件 → 为什么可以自己转。只减不增；每个文件都必须真有被豁免的写法（param-value-door-rule.test.mjs 核），不需要了就删。
 * 界面原始输入（参数面板的滑条、分镜行图片镜头的停留秒数框）读的是输入框里的字，本来就不是参数袋，规则不看它们，不用进名单。
 */
export const PARAM_VALUE_DOOR_EXITS = Object.freeze({
  'electron/shared/videoCapabilities/paramValue.ts': '门本身：判据只写在这里',
  'electron/shared/agentCapabilities/verbs/writeVerbs.ts': '外部输入解析：外部助手同时写 durationSec 与 parameters.duration 两个不同数字时当场拒收并说明',
  'electron/capabilityCore/modelAdmissionSchema.ts': '外部输入解析：给模型看的参数表单按控件声明的档位类型定字段类型（number / enum / boolean）',
})

export const PARAM_VALUE_DOOR_IGNORES = Object.freeze([
  '**/*.test.{ts,tsx}',
  '**/__tests__/**',
  ...Object.keys(PARAM_VALUE_DOOR_EXITS),
])

const BAG_NAMES = /^(parameters|params|meta|extras|stored|previousParams|paramMap|modeParams|nodeParams)$/
const DURATION_KEYS = new Set(['duration', 'durationSeconds'])
const PRODUCER_CALLS = new Set(['parseControlInput', 'declaredOptionValue', 'optionDefaultValue', 'optionValue'])
const VALUE_PARAMS = new Set(['value', 'raw', 'rawValue'])
const ITERATION_METHODS = new Set(['map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'flatMap', 'forEach'])
const CONVERSION_CALLS = new Set(['Number', 'parseInt', 'parseFloat', 'isFinite', 'isNaN'])
const NUMBER_STATICS = new Set(['parseInt', 'parseFloat', 'isFinite', 'isInteger', 'isNaN', 'isSafeInteger'])
const MAX_DEPTH = 6

function unwrap(node) {
  let current = node
  while (current && ['ChainExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion'].includes(current.type)) {
    current = current.expression
  }
  return current
}

function propertyName(member) {
  if (!member || member.type !== 'MemberExpression') return null
  if (!member.computed && member.property.type === 'Identifier') return member.property.name
  if (member.property.type === 'Literal' && typeof member.property.value === 'string') return member.property.value
  return null
}

function calleeName(call) {
  const callee = unwrap(call.callee)
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression') return propertyName(callee)
  return null
}

function isDurationLiteral(node) {
  const target = unwrap(node)
  return target?.type === 'Literal' && DURATION_KEYS.has(target.value)
}

function createAnalyzer(context) {
  const { sourceCode } = context

  function definitionOf(identifier) {
    let scope = sourceCode.getScope(identifier)
    while (scope) {
      const variable = scope.set.get(identifier.name)
      if (variable) return variable.defs[0] ?? null
      scope = scope.upper
    }
    return null
  }

  /** 参数袋：袋名变量，`x.meta` / `x.parameters` 这种读出来的袋，或初始化成袋的变量（`const p = candidate.parameters`）。 */
  function isBag(node, depth = 0) {
    const target = unwrap(node)
    if (!target || depth > MAX_DEPTH) return false
    if (target.type === 'MemberExpression') {
      const name = propertyName(target)
      return name !== null && BAG_NAMES.test(name)
    }
    if (target.type === 'LogicalExpression') return isBag(target.left, depth + 1) || isBag(target.right, depth + 1)
    if (target.type !== 'Identifier') return false
    if (BAG_NAMES.test(target.name)) return true
    const def = definitionOf(target)
    return def?.type === 'Variable' && Boolean(def.node.init) && def.node.id === def.name && isBag(def.node.init, depth + 1)
  }

  /** 函数参数里有没有叫 `control` 的。 */
  function hasControlParam(fn) {
    return fn.params.some((param) => {
      const target = param.type === 'AssignmentPattern' ? param.left : param
      return target.type === 'Identifier' && target.name === 'control'
    })
  }

  /** 迭代回调的第一个参数：回调所在的调用 receiver 是不是档位集合。 */
  function isIterationParamOfOptions(def, depth) {
    if (def.type !== 'Parameter') return false
    const fn = def.node
    if (fn.params[0] !== def.name && !(fn.params[0]?.type === 'AssignmentPattern' && fn.params[0].left === def.name)) return false
    const call = fn.parent
    if (call?.type !== 'CallExpression' || call.arguments[0] !== fn) return false
    const callee = unwrap(call.callee)
    if (callee?.type !== 'MemberExpression' || !ITERATION_METHODS.has(propertyName(callee))) return false
    return isOptionCollection(callee.object, depth + 1)
  }

  /** for (const option of control.options) 的循环变量。 */
  function isForOfOverOptions(def, depth) {
    if (def.type !== 'Variable') return false
    const declaration = def.parent
    const loop = declaration?.parent
    return loop?.type === 'ForOfStatement' && loop.left === declaration && def.node.id === def.name && isOptionCollection(loop.right, depth + 1)
  }

  /** 档位集合：`x.options` / `xxxOptions` 变量 / `readXxxOptions(...)` / 它们链式 map、filter 的结果 / 初始化成这些的变量。 */
  function isOptionCollection(node, depth = 0) {
    const target = unwrap(node)
    if (!target || depth > MAX_DEPTH) return false
    if (target.type === 'MemberExpression') {
      const name = propertyName(target)
      return name !== null && /options$/i.test(name)
    }
    if (target.type === 'CallExpression') {
      const name = calleeName(target)
      if (name && /Options$/.test(name) && unwrap(target.callee).type === 'Identifier') return true
      const callee = unwrap(target.callee)
      if (callee?.type === 'MemberExpression' && ['map', 'filter', 'slice', 'flatMap'].includes(propertyName(callee))) {
        return isOptionCollection(callee.object, depth + 1)
      }
      return false
    }
    if (target.type === 'Identifier') {
      if (/options$/i.test(target.name)) return true
      const def = definitionOf(target)
      if (def?.type === 'Variable' && def.node.init && def.node.id === def.name) return isOptionCollection(def.node.init, depth + 1)
    }
    return false
  }

  /** 档位值：档位集合迭代回调的参数、for-of 循环变量，它们的 `.value`，以及初始化成这些的变量。 */
  function isOptionValue(node, depth = 0) {
    const target = unwrap(node)
    if (!target || depth > MAX_DEPTH) return false
    if (target.type === 'MemberExpression' && propertyName(target) === 'value') return isOptionValue(target.object, depth + 1)
    if (target.type === 'Identifier') {
      const def = definitionOf(target)
      if (!def) return false
      if (isIterationParamOfOptions(def, depth) || isForOfOverOptions(def, depth)) return true
      if (def.type === 'Variable' && def.node.init && def.node.id === def.name) return isOptionValue(def.node.init, depth + 1)
      return false
    }
    if (target.type === 'ConditionalExpression') return isOptionValue(target.consequent, depth + 1) || isOptionValue(target.alternate, depth + 1)
    if (target.type === 'LogicalExpression') return isOptionValue(target.left, depth + 1) || isOptionValue(target.right, depth + 1)
    if (target.type === 'CallExpression' && calleeName(target) === 'String' && unwrap(target.callee).type === 'Identifier') {
      return target.arguments.some((argument) => isOptionValue(argument, depth + 1))
    }
    return false
  }

  /**
   * 按变量下标读袋时，下标是不是参数键：`for (const key of ['duration', 'durationSeconds'])` 的循环变量，或 `control.key`。
   * 别的下标（`meta[ANCHOR_META_KEYS.x]`、`params[key]` 读模型名、网址这类元数据）不是参数值，不管。
   */
  function isParamKey(node) {
    const target = unwrap(node)
    if (target?.type === 'MemberExpression') {
      const object = unwrap(target.object)
      return propertyName(target) === 'key' && object?.type === 'Identifier' && /control$/i.test(object.name)
    }
    if (target?.type !== 'Identifier') return false
    const def = definitionOf(target)
    if (def?.type !== 'Variable') return false
    const loop = def.parent?.parent
    return loop?.type === 'ForOfStatement' && loop.left === def.parent && unwrap(loop.right)?.type === 'ArrayExpression'
      && unwrap(loop.right).elements.some(isDurationLiteral)
  }

  /** 参数值来源：①参数袋读时长 ③转换函数产物 ④和 control 同函数的 value 参数，以及初始化成这些的变量。 */
  function isParamSource(node, depth = 0) {
    const target = unwrap(node)
    if (!target || depth > MAX_DEPTH) return false
    switch (target.type) {
      case 'MemberExpression': {
        if (target.computed && target.property.type !== 'Literal') return isBag(target.object) && isParamKey(target.property)
        const name = propertyName(target)
        if (name !== null && DURATION_KEYS.has(name)) return isBag(target.object)
        // `raw.trim()` 的 `raw.trim` 不算来源；值本身由下面的 CallExpression 分支追。
        return false
      }
      case 'CallExpression': {
        const name = calleeName(target)
        if (name && PRODUCER_CALLS.has(name)) return true
        if (target.arguments.some((argument) => isBag(argument)) && target.arguments.some((argument) => isDurationLiteral(argument))) return true
        const callee = unwrap(target.callee)
        if (callee?.type === 'Identifier' && ['String', 'Number'].includes(callee.name)) return target.arguments.some((argument) => isParamSource(argument, depth + 1))
        if (callee?.type === 'MemberExpression' && ['trim', 'toString', 'valueOf'].includes(propertyName(callee))) return isParamSource(callee.object, depth + 1)
        return false
      }
      case 'ConditionalExpression':
        return isParamSource(target.consequent, depth + 1) || isParamSource(target.alternate, depth + 1)
      case 'LogicalExpression':
        return isParamSource(target.left, depth + 1) || isParamSource(target.right, depth + 1)
      case 'Identifier': {
        const def = definitionOf(target)
        if (!def) return false
        if (def.type === 'Parameter') {
          return VALUE_PARAMS.has(target.name) && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(def.node.type) && hasControlParam(def.node)
        }
        if (def.type === 'Variable' && def.node.init && def.node.id === def.name) return isParamSource(def.node.init, depth + 1)
        return false
      }
      default:
        return false
    }
  }

  return { isParamSource, isOptionValue }
}

function typeofOperand(node) {
  const target = unwrap(node)
  return target?.type === 'UnaryExpression' && target.operator === 'typeof' ? target.argument : null
}

function stringLiteral(node) {
  const target = unwrap(node)
  if (target?.type === 'Literal' && typeof target.value === 'string') return target.value
  if (target?.type === 'TemplateLiteral' && target.expressions.length === 0) return target.quasis[0]?.value.cooked ?? null
  return null
}

function stringCallArgument(node) {
  const target = unwrap(node)
  if (target?.type !== 'CallExpression') return null
  const callee = unwrap(target.callee)
  return callee?.type === 'Identifier' && callee.name === 'String' ? target.arguments[0] ?? null : null
}

const EQUALITY = new Set(['===', '!==', '==', '!='])

export const paramValueDoorRule = {
  meta: {
    type: 'problem',
    docs: { description: '参数值只在门口规整一次：门里不许再 typeof / Number / 字符串化比较参数值' },
    schema: [],
    messages: { reparse: MESSAGE },
  },
  create(context) {
    const { isParamSource, isOptionValue } = createAnalyzer(context)
    const report = (node) => context.report({ node, messageId: 'reparse' })
    return {
      BinaryExpression(node) {
        if (!EQUALITY.has(node.operator)) return
        for (const [side, other] of [[node.left, node.right], [node.right, node.left]]) {
          const operand = typeofOperand(side)
          const kind = stringLiteral(other)
          if (operand && (kind === 'number' || kind === 'string')) {
            if (isParamSource(operand) || (kind === 'number' && isOptionValue(operand))) return report(node)
          }
        }
        const left = stringCallArgument(node.left)
        const right = stringCallArgument(node.right)
        if (left && right && [left, right].some((argument) => isParamSource(argument) || isOptionValue(argument))) report(node)
      },
      CallExpression(node) {
        const callee = unwrap(node.callee)
        const argument = node.arguments[0]
        if (!argument) return
        const conversion = (callee?.type === 'Identifier' && CONVERSION_CALLS.has(callee.name))
          || (callee?.type === 'MemberExpression' && unwrap(callee.object)?.type === 'Identifier' && unwrap(callee.object).name === 'Number' && NUMBER_STATICS.has(propertyName(callee)))
        if (conversion && (isParamSource(argument) || isOptionValue(argument))) report(node)
      },
      UnaryExpression(node) {
        if (node.operator === '+' && isParamSource(node.argument)) report(node)
      },
    }
  },
}

export const paramValueDoorPlugin = { rules: { 'no-reparse': paramValueDoorRule } }
