// 旅程注册表(Lane C)。J1-J5 对应 CLAUDE.md 五条标准核心旅程。
// needsAgent=true 的需真实模型 catalog(花 agent 文本额度,零生成额度);
// needsAgent=false 的纯 UI 零额度,可进 CI(test:journeys)。
import j1 from "./j1-promo.mjs";
import j3 from "./j3-onboarding.mjs";
import j5 from "./j5-edit-export.mjs";

// J2(故事→漫画定妆)/ J4(参考图驱动)待补——框架已就绪,按同结构新增即可。
export const JOURNEYS = [j1, j3, j5];

export function getJourneys({ ids = null, ci = false, smoke = false } = {}) {
  let list = JOURNEYS;
  if (ci) list = list.filter((j) => !j.needsAgent); // CI 只跑零额度
  if (smoke) list = list.filter((j) => j.smoke || !j.needsAgent);
  if (ids && ids.size) list = list.filter((j) => ids.has(j.id));
  return list;
}
