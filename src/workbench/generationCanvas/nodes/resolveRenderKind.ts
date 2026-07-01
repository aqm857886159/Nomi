// 节点渲染分发（renderKind）的单一真相源——决定一个画布节点走哪个 body 组件。
// 抽成纯函数以便单测 + 收口「按 kind 还是按 categoryId 渲染」的优先级规则。
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";

/** 走「卡片」式 body（非纯图片预览）的 renderKind 集合。 */
export const CARD_RENDER_KINDS = ["character-card", "scene-card", "prop-card", "audio-strip", "whiteboard-card"] as const;

/**
 * 推断节点的 renderKind。优先级：
 * 1. 素材节点（kind=asset）永远纯图片预览（renderKind=undefined）——否则落进 cast/scene 分类的
 *    素材会被误判成角色/场景卡。
 * 2. node.renderKind 显式覆盖最高。
 * 3. **按 kind 渲染 > 按 categoryId**：声音/角色/场景节点可建在任意分类——尤其拆镜头按用户拍板 A
 *    把角色/场景卡落进 `shots` 分类（与镜头同屏、参考边可见可连），此时仍要长成卡而非退化成普通图片。
 * 4. categoryId 仅作「无 kind 信号」时的兜底（如 prop 分类的 image 节点 → prop-card）。
 */
export function resolveNodeRenderKind(
  node: Pick<GenerationCanvasNode, "kind" | "renderKind" | "categoryId">,
): string | undefined {
  if (node.kind === "asset") return undefined;
  const explicit = node.renderKind as string | undefined;
  // 注：`shot-frame`（shots 分类默认 renderKind，历史迁移回填）不在 CARD_RENDER_KINDS，故按 explicit
  // 返回后走「媒体预览」路径——镜头节点就该显生成出的图/视频，不套卡片。分镜序号由 BaseGenerationNode
  // 的常显「镜头 N」角标提供（不依赖某个 ShotFrameNode 组件，那个组件从未存在，别再当它是死引用）。
  if (explicit) return explicit;
  if (node.kind === "whiteboard") return "whiteboard-card";
  if (node.kind === "audio") return "audio-strip";
  if (node.kind === "character") return "character-card";
  if (node.kind === "scene") return "scene-card";
  if (node.categoryId === "cast") return "character-card";
  if (node.categoryId === "scene") return "scene-card";
  if (node.categoryId === "prop") return "prop-card";
  if (node.categoryId === "audio") return "audio-strip";
  return undefined;
}

/** renderKind 是否走卡片式 body。 */
export function isCardRenderKind(renderKind: string | undefined): boolean {
  return CARD_RENDER_KINDS.includes(renderKind as (typeof CARD_RENDER_KINDS)[number]);
}
