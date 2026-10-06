// 修订一镜的参数：**只改被点名的键，其余不动**；值为 `null` = 删掉这个键。
//
// 这就是 JSON Merge Patch（RFC 7396）在「一层参数对象」上的语义。全仓两处修订一镜参数的地方共用这一个函数：
//   · 宿主改草稿（`capabilityCore/generationPlanPatch.ts` `resolvePlanPatch`，Agent / 外部 MCP / 付费卡）；
//   · 文稿方案改一镜（`shared/storyboard/storyboardSubjectAdapter.ts` `patchStoryboardSubject`，方案正本在渲染层）。
// 2026-10-05 之前两处都是整份替换：Agent 只改比例，清晰度掉回默认（验收线实测 4K → 1K）。

/** 参数改前 → 改后（只列变了的键，字典序）。`before` / `after` 缺省 = 那一侧没有这个键。 */
export type ParameterChange = Readonly<{ key: string; before?: unknown; after?: unknown }>;

/**
 * 把点名的参数并进原有参数。`translate` 只作用在**写了值**的那几个键上（例如把语义比例翻成这个模式的真实键），
 * 翻完再并——原有参数不参与翻译，所以「改比例」不会和原来那个真实比例键算成两处冲突。
 */
export function mergeNamedParameters(
  stored: Readonly<Record<string, unknown>>,
  named: Readonly<Record<string, unknown>> | undefined,
  translate: (written: Record<string, unknown>) => Record<string, unknown> = (written) => written,
): Record<string, unknown> {
  const entries = Object.entries(named ?? {});
  const removed = entries.filter(([, value]) => value === null).map(([key]) => key);
  const merged: Record<string, unknown> = { ...stored, ...translate(Object.fromEntries(entries.filter(([, value]) => value !== null))) };
  for (const key of removed) delete merged[key];
  return merged;
}

export function parameterChanges(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): ParameterChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      key,
      ...(Object.prototype.hasOwnProperty.call(before, key) ? { before: before[key] } : {}),
      ...(Object.prototype.hasOwnProperty.call(after, key) ? { after: after[key] } : {}),
    }));
}
