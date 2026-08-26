import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// Wan 3.0 视频档案（APIMart 独占）。契约来自官方文档实查（2026-08-27，R5）：
//   docs.apimart.ai/{cn,en}/api-reference/videos/wan3.0-video/generation，非记忆。
//
// **为什么与 kie 的 wan-3.0 分档**（沿用 seedance-2 / seedance-2-apimart 先例）：同一模型、
// 两套 wire。kie 是 async job（一切嵌 input 下、first_frame_url 裸串、reference_*_urls 三族），
// apimart 是扁平 body（image_with_roles / image_urls / video_urls / audio_urls）且比例字段叫
// `size` 不叫 aspect_ratio。字段名与嵌套都不同 → 两个档案，不是一个档案两套 vendorParams。
//
// **generation_type 为什么必须 fixedParams 钉死**：apimart 把 `image_urls` 在两族之间**重载**了
//   —— 首/尾帧族和参考族都可能用它，只有 generation_type 能告诉上游「这批素材是哪一族」。
// 文档说不传会自动判断，但自动判断对「1 张图」这种两族都成立的输入是歧义的（1 张图既可解释成
// 首帧、也可解释成参考图）。歧义交给上游猜 = 用户拿到的片子形态不可预期，故按模式显式钉死。
//
// **首/尾帧走 image_with_roles**：combineSlotsInto 通用原语，role 由 slot.kind 派生
// （first_frame → "first_frame"、last_frame → "last_frame"，见 archetypeMeta 的 DEFAULT_ROLE_FOR_KIND），
// 与官方 role 取值逐字相同，不需要 roleName 覆盖。
//
// 本轮**不接** file_url（文档参考）与 link_url（网页参考），理由同 kie 侧，
// 见 docs/plan/2026-08-27-wan-3-0-integration.md。
// ---------------------------------------------------------------------------

const opt = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

// 官方默认：resolution 1080P、size adaptive、duration 5、audio true、watermark false。
// 比例字段名是 **size**（文档全部示例用 size；aspect_ratio 仅作别名提及）——同 Wan 2.7 apimart。
const SIZE: ModelParameterControl = {
  key: "size",
  label: "比例",
  type: "select",
  options: opt(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  defaultValue: "adaptive",
};

const RESOLUTION: ModelParameterControl = {
  key: "resolution",
  label: "清晰度",
  type: "select",
  options: opt(["480P", "720P", "1080P"]),
  defaultValue: "1080P",
};

// duration 官方 [2,30]，另允许 -1 = 由模型自定（哨兵值不给控件，同 kie 侧处理）。
const DURATION: ModelParameterControl = {
  key: "duration",
  label: "时长(秒)",
  type: "number",
  options: [],
  min: 2,
  max: 30,
  defaultValue: 5,
};

const AUDIO: ModelParameterControl = { key: "audio", label: "生成音频", type: "boolean", options: [], defaultValue: true };
const WATERMARK: ModelParameterControl = { key: "watermark", label: "水印", type: "boolean", options: [], defaultValue: false };
const SEED: ModelParameterControl = { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" };

const BASE_PARAMS: ModelParameterControl[] = [SIZE, RESOLUTION, DURATION, AUDIO, WATERMARK, SEED];

// 首/尾帧模式：比例由参考帧决定 → **不声明 size 控件，也不发这个字段**，由官方默认（adaptive）接管。
// 不留「只有一个选项的假下拉」（设计系统 C1「可点即有效」）。
// 是「不发」而非「发常量」：官方写明缺省即 adaptive，少发一个字段比钉死一个值更诚实。
// （注意本档案的比例字段名是 `size`，不是 kie 那份的 `aspect_ratio`——同一个模型两家不同名。）
const FRAME_PARAMS: ModelParameterControl[] = BASE_PARAMS.filter((p) => p.key !== "size");

export const WAN_3_0_APIMART_ARCHETYPE: ModelArchetype = {
  id: "wan-3.0-apimart",
  family: "wan",
  label: "Wan 3.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["wan3.0-video", "wan3-0-video"],
  sources: [
    {
      url: "https://docs.apimart.ai/cn/api-reference/videos/wan3.0-video/generation",
      checkedAt: "2026-08-26",
      vendorKey: "apimart",
      covers:
        "POST /v1/videos/generations 扁平 body，model 固定 wan3.0-video（单 id，模式靠 generation_type 区分）；" +
        "generation_type frame|reference（不传则上游自动判断，本档案按模式钉死）；" +
        "首/尾帧走 image_with_roles [{url,role}]，role 取 first_frame|last_frame|reference_image；" +
        "参考族 image_urls 最多 10 + video_urls 最多 5 + audio_urls 最多 5（视频/音频每段 1-15s、合计 ≤15s）；" +
        "比例字段名是 size（aspect_ratio 仅别名）adaptive|16:9|4:3|1:1|3:4|9:16 默认 adaptive；" +
        "resolution 480P|720P|1080P 默认 1080P；duration [2,30] 或 -1 默认 5；audio 默认 true；" +
        "watermark 默认 false；nsfw_check 默认 false；seed [0,2147483647]；" +
        "响应 data[0].task_id，两族素材禁止混用",
    },
  ],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频，最长 30 秒，自带音轨",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: BASE_PARAMS,
    },
    {
      id: "first",
      intent: "single",
      vendorTerm: "首帧",
      hint: "单张首帧图驱动生成（比例由首帧决定）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1 }],
      combineSlotsInto: { key: "image_with_roles" },
      fixedParams: { generation_type: "frame" },
      params: FRAME_PARAMS,
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "首帧 + 尾帧，过渡更可控（比例由首帧决定）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1 },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1 },
      ],
      combineSlotsInto: { key: "image_with_roles" },
      fixedParams: { generation_type: "frame" },
      params: FRAME_PARAMS,
    },
    {
      // 全能参考：官方上限 10 图 / 5 视频 / 5 音频。参考图走裸 image_urls（不合并进 image_with_roles）——
      // 与首/尾帧族的区分完全由 generation_type=reference 承担。
      id: "ref",
      intent: "character",
      vendorTerm: "全能参考",
      hint: "多模态参考；最多 10 图 / 5 视频 / 5 音频（视频与音频每段 1-15 秒）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      fixedParams: { generation_type: "reference" },
      slots: [
        { kind: "image_ref", label: "参考图", min: 0, max: 10, characterIndexed: true, inputKey: "image_urls" },
        { kind: "video_ref", label: "参考视频", min: 0, max: 5, inputKey: "video_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 5, inputKey: "audio_urls" },
      ],
      params: BASE_PARAMS,
    },
  ],
};
