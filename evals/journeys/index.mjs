// 旅程注册表(Lane C)。needsAgent=true 的需真实模型 catalog(花 agent 文本额度,零生成额度);
// needsAgent=false 的纯 UI 零额度,可进 CI(test:journeys)。
//
// 2026-06-23 删 j3-onboarding / j5-edit-export:二者断言的是已被产品决策移除的 UI——
// j3 找的「30 秒体验」单 CTA(v3 上手改版已删,空库改走标准布局)、j5 找的空白项目「关键画面」
// 默认节点(2026-06-15 用户拍板删预设两卡,新建即空画布)。对当前 UI 是永远红的假阴性
// (在改动前的原始 main 上同样 0/2),留着只会误报回归。待补:按当前流程重写零额度 journey。
import j1 from "./j1-promo.mjs";
import j3 from "./j3-first-success.mjs";
import j5 from "./j5-edit-export.mjs";
import j6 from "./j6-camera-move.mjs";
import { selectJourneys } from "../../scripts/eval-journey-selection.mjs";

// J1(宣传片)/J6(AI 运镜)= agent 驱动(needsAgent)。零额度 CI journey 暂缺,按当前 UI 流程补。
export const JOURNEYS = [j1, j3, j5, j6];

export function getJourneys({ ids = null, ci = false, smoke = false } = {}) {
  return selectJourneys(JOURNEYS, { ids, ci, smoke }).selected;
}
