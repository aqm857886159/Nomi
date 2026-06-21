// 「学到的默认值」—— 修(fix)agent 能改、被 loop 客观裁决的可回滚数据结构。
// 物化视图思想(仿 projectMemory):可全量重建、可回滚。S2 先放 refEdgeMode 一项,
// 后续切片扩(默认参数/提示词模板…)。注入点(产品侧)留到迁移收尾。
export type LearnedDefaults = {
  /** 能力族 → 参考边应使用的边模式(空=回退泛用 'reference')。 */
  refEdgeMode: Record<string, string>;
};

export const baselineDefaults = (): LearnedDefaults => ({ refEdgeMode: {} });

export const cloneDefaults = (d: LearnedDefaults): LearnedDefaults => ({
  refEdgeMode: { ...d.refEdgeMode },
});
