// manual 模型接入「保存」门槛决策（纯函数，单一真相源）。
//
// 产品决策（2026-06-14 用户拍板，R3）：连通性「测试连接」是**非阻断**的——默认鼓励先测，
// 但测试失败 / 未测时不死拦提交，保存按钮改「仍要保存」需二次确认（force-confirm），
// 既保留早验证又不把 /models 未实现 / 代理抖动等误判挡住其实可用的端点。
//
// 此前（commit dbe6665）把保存硬拦在 testState==='ok'，与交接文档 + catalogCommit 设计注
// 「不拦提交」相左；本函数收口为唯一门槛逻辑，UI 只按它渲染按钮，杜绝条件散落组件各处。

export type ManualSaveAction =
  | "disabled" // 必填项未齐 / 正在保存 → 不可点
  | "save" // 测试已通过 → 直接保存
  | "arm" // 未测/测试失败、首次点击 → 进入二次确认（不提交）
  | "confirm"; // 已 armed、再次点击 → 强行保存

export type ManualSaveGateInput = {
  /** baseUrl 合法 && 有 apiKey && 至少一个 modelId && 未在保存中。 */
  fieldsReady: boolean;
  /** testState === 'ok'。 */
  testPassed: boolean;
  /** 已进入「仍要保存」的二次确认态。 */
  forceArmed: boolean;
};

export function resolveManualSaveAction(input: ManualSaveGateInput): ManualSaveAction {
  if (!input.fieldsReady) return "disabled";
  if (input.testPassed) return "save";
  return input.forceArmed ? "confirm" : "arm";
}
