import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// Veo 3.1 官方通道 Fast / Quality（APIMart 官方页 docs.apimart.ai/en/api-reference/videos/veo3/generation-official.md，2026-11-07 核）。
// model `veo3.1-fast-official` / `veo3.1-quality-official`，参数逐字相同，只是快慢与单价不同；
// 与现有 veo-3.1 档案（Ext 通道，按次计费、固定 8 秒）是不同通道，两者都可选。
// 官方通道：按秒计费，duration 4 / 6 / 8，resolution 720p(默认) / 1080p / 4K，比例 16:9 / 9:16，
// generate_audio 官方默认 false（开了每秒更贵），本档案声明并默认关。
// 有图就是图生视频：first_frame_image 必填，last_frame_image 可选。
// 不声明：negative_prompt / seed / sample_count / person_generation / resize_mode / enhance_prompt（默认值即可用，
// enhance_prompt 官方只允许 true），也不接 Ext 的 4K 续拍合同。

const opt = (values: Array<string | number>): ModelParameterControl["options"] => values.map((value) => ({ value, label: String(value) }));

const ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16"]), defaultValue: "16:9" };
const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["720p", "1080p", "4K"]), defaultValue: "720p" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "select", options: opt([4, 6, 8]), defaultValue: 8 };
const AUDIO: ModelParameterControl = { key: "generate_audio", label: "生成声音", type: "boolean", options: [], defaultValue: false };

function veoOfficial(modelId: string, label: string): ModelArchetype {
  return {
    id: modelId,
    family: "veo",
    label,
    kind: "video",
    defaultModeId: "t2v",
    transportTaskKind: "text_to_video",
    identifierPatterns: [modelId],
    sources: [{
      url: "https://docs.apimart.ai/en/api-reference/videos/veo3/generation-official.md", checkedAt: "2026-11-07", vendorKey: "apimart",
      covers:
        `POST /v1/videos/generations，model \`${modelId}\`；duration 整数 4|6|8(默认 8，不能加引号)；aspect_ratio 16:9(默认)|9:16；` +
        "resolution 720p(默认)|1080p|4K；generate_audio 布尔(默认 false)；有图即图生：first_frame_image 必填、last_frame_image 可选；" +
        "不声明 negative_prompt / seed / sample_count / person_generation / resize_mode / enhance_prompt。",
    }],
    modes: [
      { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: [ASPECT, RESOLUTION, DURATION, AUDIO] },
      {
        id: "i2v", intent: "firstlast", vendorTerm: "图生视频", hint: "首帧必填，尾帧可选", promptRequired: true, transportTaskKind: "image_to_video",
        slots: [
          { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false },
          { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "last_frame_image", asArray: false },
        ],
        params: [ASPECT, RESOLUTION, DURATION, AUDIO],
      },
    ],
  };
}

export const VEO_31_FAST_OFFICIAL_ARCHETYPE = veoOfficial("veo3.1-fast-official", "Veo 3.1 Fast 官方");
export const VEO_31_QUALITY_OFFICIAL_ARCHETYPE = veoOfficial("veo3.1-quality-official", "Veo 3.1 Quality 官方");
