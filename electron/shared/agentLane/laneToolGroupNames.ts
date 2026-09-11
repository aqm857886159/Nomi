// Agent lane · 工具组**名字**的唯一 owner（叶子模块：不 import 任何东西）。
//
// 为什么单独一个文件：`laneToolCatalog.ts`（目录）要按组名把「原生装配层执行的组」排除在延迟目录外，
// `laneToolGroups.mts`（组切换）要按组名注册 coding 组，而后者已经 import 前者——组名再放进任一边
// 就是一条静态循环（`check:boundaries` 当场红）。名字是契约，住中立层。
export const LANE_CODING_TOOL_GROUP = 'coding';
/** 模型目录读（`nomi_read`）的组。执行由原生装配层绑定（`laneNativeAssembly.mts`），与 `coding` 同一类。 */
export const LANE_MODELS_TOOL_GROUP = 'models';
/** 由原生装配层注册与执行的组；`laneToolCatalog.ts` 的延迟目录不含它们，否则同一个工具会被装配两次。 */
export const LANE_NATIVE_TOOL_GROUPS: readonly string[] = Object.freeze([LANE_CODING_TOOL_GROUP, LANE_MODELS_TOOL_GROUP]);
