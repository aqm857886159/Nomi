/** 单镜审片三态：真审过无偏离（passed）/ 真审过有偏差（flagged）/ 未完成校验（unverified，绝不等于通过）。 */
export type QaShotVerdictStatus = "passed" | "flagged" | "unverified";

/** 单镜未能完成画面审片的精确原因（结构化枚举，供主进程摘要与渲染层 i18n 共用）。 */
export type QaShotUnverifiedReason =
  | "vision_unavailable"
  | "missing_frame_source"
  | "frame_extract_failed"
  | "judge_failed"
  | "invalid_verdict_json";

/** qa 阶段结构化审片统计（供界面按当前语言渲染诚实三态结论，老 run 无此字段时回落 qaSummary）。 */
export type QaStageReport = {
  total: number;
  passedCount: number;
  flaggedCount: number;
  unverifiedCount: number;
  flaggedDimensions?: string[];
  unverifiedReasons?: QaShotUnverifiedReason[];
  skipped?: boolean;
  skipReason?: string;
};
