// 画布节点上「不是用户编辑」的字段——唯一清单（渲染层与主进程共用）。
//
// 节点对象里混着两层：用户编辑（位置、提示词、参数、连线……）和系统事实。系统事实只由生成运行写：
// - 运行态：任务此刻的真实状态（运行记录 / 状态 / 错误 / 进度）；
// - 落地：生成结局留在节点上的东西（主图 / 版本列表 / 出过的最大版本号 / 文本定稿）。
// 撤销 / 重做不回退运行态、并把之后的落地重新叠回（store/nodeRunOutcome.reapplyLandedOutcomes）；
// 外部整张写回画布不许改这两层（externalCanvasWrite.mergeExternalCanvasWrite）。钱已经花了，结果不能丢。
export const NODE_RUN_STATE_FIELDS = ['runs', 'status', 'error', 'progress'] as const
export const NODE_LANDED_FIELDS = ['result', 'history', 'resultVersionMax', 'contentJson'] as const
