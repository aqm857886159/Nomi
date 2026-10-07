// 铁律 ⑩「说的 = 摆的」模型那一半：用户一句话里的约束，Agent 起草时有没有一个不落地写进草稿。
//
// 形态与 storyboard.mjs 相同：case = { id, description, input.message, expect }。评分在 evals/lib/intentGrading.mjs，
// 只做确定性比对（期望字段 ↔ Agent 第一次 `draft_shots` 写下的字段），judge 不参与通过判定。
//
// expect.draft 词表（只写用户真说了的约束；没说的不核，那是默认值的事）：
//   count: n                  草稿里一共几镜 / 几张
//   kind: 'image'|'video'     每一镜的种类（按 taskKind，或点名模型 / 模式推得的种类）
//   durationSec: n            每一镜的时长（秒）
//   aspectRatio: '16:9'       每一镜的比例（draft_shots 的比例字段合入前，读 parameters 里 aspect_ratio / ratio / 比例语义的 size）
//   modelMatch: 'regex'       每一镜点名的模型 id 要匹配（大小写不敏感）
//   references: n             每一镜带的参考素材个数
//   noGenerate: true          用户说了「先别生成 / 只起草」：这一轮不许调 generate
//   honesty: 'regex'          越界 / 做不到时，回复里必须如实说出来（大小写不敏感）
//   noDraft: true             用户要的东西做不到时，不许硬起草一份不符合的
//
// split：train 用来调说明书 / 提示词，test 留出不看（按 Anthropic 的 eval 爬坡做法；只有 Agent 改动才用）。
// 两种语言各半；每个 en 用例与一个 zh 用例考同一种约束，但措辞不是逐句翻译。
//
// 花费：每条 = 一个真实 Agent 回合（大脑走用户在面板里选的对话模型；生成一律停在付费卡，不发供应商）。
// 估算见 TOKEN_ESTIMATE；默认不跑，`pnpm eval:run intent-draft` 不带 --spend-ok 会直接拒绝。

export const datasetName = "intent-draft";

/** 只有显式开关才跑真模型。 */
export const requiresSpendOptIn = true;

/**
 * 每条大概花多少 token（只算 Agent 大脑；生成不发）。依据：一个起草回合通常 2–4 次模型请求
 * （list_models / draft_shots / 回复），每次输入受 electron/agentLane/laneContextBudget.mts 的
 * LANE_CONTEXT_TOKEN_BUDGET（8 万）约束。常见值是估算、未实测（unverified），首次真跑后用 scores.json 的 tokensTotal 更新。
 */
export const TOKEN_ESTIMATE = Object.freeze({
  perCaseTypical: 90_000,
  perCaseUpperBound: 320_000,
  basis: "2–4 次请求 × 每次输入预算 80k（上限）；常见按 3 次 × 3 万估，unverified",
});

const zh = (id, description, message, draft, split = "train") => ({ id, lang: "zh", split, description, input: { message }, expect: { draft } });
const en = (id, description, message, draft, split = "train") => ({ id, lang: "en", split, description, input: { message }, expect: { draft } });

export const cases = [
  // ── 比例 ──
  zh("it-zh-01", "比例 · 16:9 视频", "帮我起草一条 16:9 的视频镜头：清晨的渔港，一条小船出海。先别生成。", { count: 1, kind: "video", aspectRatio: "16:9", noGenerate: true }),
  en("it-en-01", "aspect · vertical 9:16 image", "Draft one vertical 9:16 image of a neon street food stall at night. Don't generate yet.", { count: 1, kind: "image", aspectRatio: "9:16", noGenerate: true }),
  zh("it-zh-02", "比例 · 竖屏说法（9:16）", "做三张竖屏的海报草稿，主题是秋天的咖啡馆，竖屏发小红书用。只起草，不要生成。", { count: 3, kind: "image", aspectRatio: "9:16", noGenerate: true }, "test"),
  en("it-en-02", "aspect · square 1:1", "I need two square images (1:1) of a ceramic mug on a wooden table, drafts only.", { count: 2, kind: "image", aspectRatio: "1:1", noGenerate: true }, "test"),
  // ── 时长 ──
  zh("it-zh-03", "时长 · 每镜 5 秒", "起草 2 个视频镜头，每个 5 秒：猫跳上窗台、猫看窗外的雨。先不生成。", { count: 2, kind: "video", durationSec: 5, noGenerate: true }),
  en("it-en-03", "duration · 10 seconds", "Draft a single 10-second video shot of waves crashing on black sand. Hold off on generating.", { count: 1, kind: "video", durationSec: 10, noGenerate: true }),
  zh("it-zh-04", "时长 + 比例同时", "要一条 8 秒、16:9 的视频草稿：雪山脚下的火车穿过隧道。先别生成。", { count: 1, kind: "video", durationSec: 8, aspectRatio: "16:9", noGenerate: true }, "test"),
  en("it-en-04", "duration + aspect together", "Draft one 6 second clip in 9:16 of a barista pouring latte art. Not generating yet.", { count: 1, kind: "video", durationSec: 6, aspectRatio: "9:16", noGenerate: true }, "test"),
  // ── 张数 ──
  zh("it-zh-05", "张数 · 4 张图", "给我起草 4 张不同角度的运动鞋产品图，白底。先别生成。", { count: 4, kind: "image", noGenerate: true }),
  en("it-en-05", "count · 3 images", "Draft 3 images of the same red bicycle in three different seasons. Draft only.", { count: 3, kind: "image", noGenerate: true }),
  zh("it-zh-06", "张数 · 数字干扰（文里有 10，要 2）", "店里有 10 款面包，这次只要 2 张图的草稿：可颂特写、法棍切面。先不要生成。", { count: 2, kind: "image", noGenerate: true }, "test"),
  en("it-en-06", "count · distractor number", "We sell 12 flavours but I only want 2 image drafts: mango sorbet and dark chocolate. Don't generate.", { count: 2, kind: "image", noGenerate: true }, "test"),
  // ── 模型点名 ──
  zh("it-zh-07", "模型点名 · Seedance", "用 Seedance 起草一条视频镜头：舞者在落日下转身。先别生成。", { count: 1, kind: "video", modelMatch: "seedance", noGenerate: true }),
  en("it-en-07", "model named · GPT Image", "Use GPT Image to draft one image of a paper boat on a puddle. Don't generate yet.", { count: 1, kind: "image", modelMatch: "gpt[-_ ]?image", noGenerate: true }),
  zh("it-zh-08", "模型点名 · 即梦 / Seedream 图片", "用 Seedream 起草两张图：古镇雨夜、灯笼倒影。只起草。", { count: 2, kind: "image", modelMatch: "seedream", noGenerate: true }, "test"),
  en("it-en-08", "model named · Kling", "Draft one Kling video shot of a fox running through snow. Hold the generation.", { count: 1, kind: "video", modelMatch: "kling", noGenerate: true }, "test"),
  // ── 参考（项目里没有对应素材：不许编一个参考）──
  zh("it-zh-09", "参考 · 素材库里没有那张图", "参考我素材库里那张「橘猫定妆照」，起草一张橘猫坐在屋顶的图。先别生成。", { references: 0, honesty: "没有|找不到|没找到|不在|上传", noGenerate: true }),
  en("it-en-09", "reference · asset does not exist", "Use the 'hero portrait' from my library as reference and draft one image of her on a rooftop. Draft only.", { references: 0, honesty: "can't find|cannot find|couldn't find|not in your library|no .*(asset|image)|upload", noGenerate: true }, "test"),
  // ── 先别生成 ──
  zh("it-zh-10", "先别生成 · 只要方案", "我只想先看看方案：起草 3 个镜头讲一杯奶茶的制作过程，别生成，也别花钱。", { count: 3, noGenerate: true }),
  en("it-en-10", "no generate · plan only", "Just plan it, don't spend anything: draft 2 shots of a sunrise over a lighthouse.", { count: 2, noGenerate: true }, "test"),
  // ── 越界值（模型做不到：如实说，不硬写）──
  zh("it-zh-11", "越界 · 时长 90 秒单镜", "起草一条 90 秒的单个视频镜头，一镜到底拍城市夜景。先别生成。", { honesty: "秒|最长|不支持|拆|分成", noGenerate: true }),
  en("it-en-11", "out of range · 2-hour clip", "Draft a single 2-hour continuous video shot of a forest. Don't generate.", { honesty: "second|maximum|max|longest|can't|cannot|split|break", noGenerate: true }, "test"),
  zh("it-zh-12", "越界 · 不存在的比例", "起草一张 7:1 超宽比例的城市天际线图，先不生成。", { honesty: "7:1|比例|不支持|最接近|没有", noGenerate: true }),
  en("it-en-12", "out of range · impossible aspect", "Draft one image in a 13:2 aspect ratio of a train panorama. Draft only.", { honesty: "13:2|aspect|not supported|closest|isn't available|unsupported", noGenerate: true }, "test"),
  // ── 一句话里约束多（综合）──
  zh("it-zh-13", "综合 · 张数 + 比例 + 模型", "用 GPT Image 起草 2 张 1:1 的头像：一个戴耳机的女孩、一个戴帽子的男孩。先别生成。", { count: 2, kind: "image", aspectRatio: "1:1", modelMatch: "gpt[-_ ]?image", noGenerate: true }, "test"),
  en("it-en-13", "combined · count + duration + aspect", "Draft 3 video shots, 5 seconds each, 16:9: a kettle boiling, tea poured, steam rising. Don't generate.", { count: 3, kind: "video", durationSec: 5, aspectRatio: "16:9", noGenerate: true }),
];
