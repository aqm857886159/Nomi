// 助手面板里读「原始选区字段」只经选区主人（2026-11-17，设计卡 docs/plan/2026-11-17-agent-selection-one-home.md）。
//
// 一次发送里「我选中了什么」曾在三处各算：发送目标、冻结快照、聊天框芯片。预览里只选一段文字时，芯片亮着、助手那一轮却收不到；
// 选区里有重复 / 不存在的项时三处数出来不一样；素材名空白时一处回落成 ID、一处显示空白芯片。
// 现在只有 src/workbench/ai/resident/residentContextSnapshot.ts 的 resolveResidentSelection 算，别处只拿它的结果。
//
// 这是 ESLint 一条规则的数据（eslint.config.mjs 以独立规则 id `resident-selection/no-restricted-syntax` 注册）：
// 在助手面板目录（src/workbench/ai）里，除选区主人和芯片订阅 hook 两个文件外，不许读 store 里的原始选区字段：
// 点号、可选链、方括号字面量、解构、选择器 `(s) => s.selectedX` 都算（它们都是 MemberExpression 或 ObjectPattern 属性）。
//
// 有意接受的缺口（静态看不出）：先把整个 store 状态传给别的函数、在那里读；用拼出来的属性名取值；换了名字、自己 `.filter` 时间轴片段
// 重建成员（这一类靠 concept-owners 里 agent.resident-selection 的定义禁令拦同名旧函数，拦不住任意改名重写，不声称全封）。

const FIELDS = '/^(?:selectedNodeIds|selectedTimelineClipIds|selectedTextClipId)$/'

export const RESIDENT_SELECTION_OWNER_FILES = Object.freeze([
  'src/workbench/ai/resident/residentContextSnapshot.ts',
  'src/workbench/ai/resident/timelineAgentSurface.tsx',
])

const MESSAGE = '助手面板里不要直接读原始选区字段（selectedNodeIds / selectedTimelineClipIds / selectedTextClipId）：'
  + '发送目标、冻结快照、聊天框芯片三处各算一遍就会对不上（预览里只选文字时芯片亮着、助手却收不到）。'
  + '选了什么只经 src/workbench/ai/resident/residentContextSnapshot.ts 的 resolveResidentSelection；芯片用 useResidentTimelineMembers。见 scripts/resident-selection-owner.mjs。'

export const RESIDENT_SELECTION_SELECTORS = Object.freeze([
  // x.selectedNodeIds / x?.selectedNodeIds / s => s.selectedTextClipId
  { selector: `MemberExpression[computed=false][property.name=${FIELDS}]`, message: MESSAGE },
  // x['selectedNodeIds']
  { selector: `MemberExpression[computed=true][property.value=${FIELDS}]`, message: MESSAGE },
  // const { selectedNodeIds } = state / const { selectedNodeIds: ids } = state
  { selector: `ObjectPattern > Property[key.name=${FIELDS}]`, message: MESSAGE },
  { selector: `ObjectPattern > Property[key.value=${FIELDS}]`, message: MESSAGE },
].map((entry) => Object.freeze(entry)))

/** 规则管的范围：助手面板目录的源码（测试除外）。 */
export const RESIDENT_SELECTION_FILES = Object.freeze(['src/workbench/ai/**/*.{ts,tsx}'])
export const RESIDENT_SELECTION_TEST_FILES = Object.freeze(['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'])
