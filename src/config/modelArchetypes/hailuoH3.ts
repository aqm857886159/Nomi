import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// MiniMax H3（官方 V2 视频）档案。V2 走 content 多模态数组 + ratio 比例字段（t2v ratio 必填非 adaptive）。
// resolution 官方枚举 768P/2K；duration 离散 6/8/10；ratio 16:9/9:16/1:1/4:3/3:4。
// 目前只种 t2v；i2v 需 MiniMax 文件上传资产吞入（暂缓，见 docs/plan/2026-08-29-minimax-vendor.md）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const numOpt = (values: number[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: `${value}` }));

const PARAMS: ModelParameterControl[] = [
  { key: "resolution", label: "清晰度", type: "select", options: opt(["768P", "2K"]), defaultValue: "768P" },
  { key: "duration", label: "时长(秒)", type: "select", options: numOpt([6, 8, 10]), defaultValue: 6 },
  { key: "ratio", label: "画面比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" },
];

export const HAILUO_H3_ARCHETYPE: ModelArchetype = {
  id: "hailuo-h3",
  family: "hailuo",
  label: "MiniMax H3",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  sources: [
    { url: "https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create.md", checkedAt: "2026-08-29", vendorKey: "minimax", covers: "t2v content 数组 + ratio/resolution/duration 枚举；query 走 task_id 路径参数" },
  ],
  identifierPatterns: ["hailuo-h3"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: PARAMS,
    },
  ],
};
