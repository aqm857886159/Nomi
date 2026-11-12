import type { ModelParameterControl, ModelArchetype } from "./types";

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: options(["480P", "768P"]), defaultValue: "768P" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 5, max: 15, defaultValue: 5 };

// APIMart 通道（官方页 docs.apimart.ai/en/api-reference/videos/minimax-h3/max.md，2026-11-12 核）：清晰度比 fal / MiniMax 官方多一档 1080P
// （「Output resolution: 480P, 768P (default), or 1080P」），文生比例多 21:9（「Text-to-video values: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16」），
// 时长 5–15 同。水印只在 480P / 768P 支持、1080P 必须不发——这里不声明水印控件，所以永远不会带出去。
// 多模态参考生（ref 方式：image_urls ≤9 / video_urls ≤3 / audio_urls ≤3，音频必须配图或视频；与首尾帧互斥）只在 APIMart 这条通道上有：
// fal 的 mapping 按方式 id 对应（t2v / i2v），没有 ref 的 mapping 就会在 fal 那一行隐藏这个方式，不会出现发不出去的方式。
// 比例：ref 方式可选，默认 adaptive（跟随素材），也可指定六个比例；adaptive 经 omitAuto 不发。中间帧官方明说不支持；
// 水印不声明（1080P 必须不发，替创作者定：不加）；webhook 是管道。能力表：docs/models/capabilities/minimax-h3-max-apimart.md。
const APIMART_RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: options(["480P", "768P", "1080P"]), defaultValue: "768P" };
const APIMART_ASPECT_REF: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: options(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), defaultValue: "adaptive" };
const APIMART_ASPECT: ModelParameterControl = { key: "aspect_ratio", label: "比例", type: "select", options: options(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]), defaultValue: "16:9" };

export const MINIMAX_H3_MAX_ARCHETYPE: ModelArchetype = {
  id: "minimax-h3-max", family: "minimax", label: "MiniMax H3-Max", kind: "video", defaultModeId: "t2v", transportTaskKind: "text_to_video",
  identifierPatterns: ["minimax/h3-max", "MiniMax-H3-Max"],
  sources: [
    { url: "https://platform.minimaxi.com/docs/guides/video-generation", checkedAt: "2026-09-02", vendorKey: "minimax", covers: "POST /v2/video_generation: MiniMax-H3-Max supports text, first/last-frame, and multimodal reference video; 480P/768P, 5–15 seconds." },
    {
      url: "https://docs.apimart.ai/en/api-reference/videos/minimax-h3/max.md", checkedAt: "2026-11-12", vendorKey: "apimart",
      covers:
        "POST /v1/videos/generations，model `MiniMax-H3-Max`；duration 5–15 整数(默认 5，4 不支持)；resolution 480P|768P(默认)|1080P，2K 返回 400；" +
        "文生 aspect_ratio 21:9|16:9(默认)|4:3|1:1|3:4|9:16；图生比例由输入图决定；首帧 first_frame_image、尾帧 last_frame_image，" +
        "不支持中间帧；水印 1080P 不能发。多模态参考 image_urls ≤9 / video_urls ≤3(每段 2–15 秒、合计 ≤15 秒) / audio_urls ≤3，音频须配图或视频，与首尾帧互斥，比例默认 adaptive；不声明：watermark、webhook。",
    },
  ],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "极速生成视频", promptRequired: true, slots: [], params: [RESOLUTION, DURATION, { key: "aspect_ratio", label: "比例", type: "select", options: options(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" }], vendorParams: { apimart: [APIMART_RESOLUTION, DURATION, APIMART_ASPECT] } },
    { id: "i2v", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧必填，尾帧可选", promptRequired: true, transportTaskKind: "image_to_video", slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_image", asArray: false }, { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "last_frame_image", asArray: false }], params: [RESOLUTION, DURATION], vendorParams: { apimart: [APIMART_RESOLUTION, DURATION] } },
    {
      id: "ref", intent: "character", vendorTerm: "多模态参考", hint: "参考图 ≤9 + 参考视频 ≤3 + 参考音频 ≤3；音频须配图或视频", promptRequired: true, transportTaskKind: "image_to_video",
      slots: [
        { kind: "image_ref", label: "参考图", min: 0, max: 9, characterIndexed: true, inputKey: "image_urls" },
        { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "video_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "audio_urls" },
      ],
      params: [], vendorParams: { apimart: [APIMART_RESOLUTION, DURATION, APIMART_ASPECT_REF] },
    },
  ],
};
