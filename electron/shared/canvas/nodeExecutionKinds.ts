// 「哪些画布节点种类会生成东西」的**唯一词表**（中立契约层，主进程与渲染层共用）。
//
// 为什么住这里而不是 `src/workbench/generationCanvas/nodes/registry.ts`：Agent 工具面要在**主进程**里裁决
// 「模型想用 arrange_canvas / make_artifact 造一个生成类节点」——那必须 `wrong_verb` 拒绝并点名
// `draft_shots`（设计正本 §5.2；根因合同 2026-09-11-agent-generation-second-door）。主进程不能 import 渲染层
// （`check:boundaries`），而这条判据又不许在闸里手写第二份名单（合同不变量 3）。所以词表搬到这里，
// 渲染层的插件注册表 import 它、并由一条对账测试保证两边逐字一致。
export const GENERATION_NODE_EXECUTION_KINDS = ["image", "video", "text", "audio", "model3d"] as const;
export type GenerationNodeExecutionKind = (typeof GENERATION_NODE_EXECUTION_KINDS)[number];

/**
 * 节点种类 → 它生成什么。**不在表里的种类不生成**（shot_table / clip / shot / output / panorama / director /
 * whiteboard / asset / agent-artifact）。
 */
export const NODE_EXECUTION_KIND_BY_NODE_KIND: Readonly<Record<string, GenerationNodeExecutionKind>> = Object.freeze({
  text: "text",
  character: "image",
  scene: "image",
  image: "image",
  keyframe: "image",
  video: "video",
  audio: "audio",
  model3d: "model3d",
});

/** 模型面唯一的「这是不是生成类节点」判据。 */
export function isGeneratingNodeKind(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(NODE_EXECUTION_KIND_BY_NODE_KIND, kind);
}
