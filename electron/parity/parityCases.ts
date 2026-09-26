/**
 * 对等矩阵的输入用例。**每个用例跑遍全部入口**，以手动画布入口为基准逐字段比。
 * 用的全是真实内置目录里的行（`ensureBuiltinModelSeeds()` 种下来的那份），不是自造的假模型——
 * 自造模型只能证「我们编的世界里两边一样」。
 */

export type ParityCase = {
  id: string;
  /** 用户那一刻在做什么（用户镜头，不是实现镜头）。 */
  userStory: string;
  vendorKey: string;
  modelKey: string;
  /** 目录任务种类。 */
  taskKind: string;
  /** 用户写进描述框的原文（可能含 `@[asset:…]` 持久化标记）。 */
  prompt: string;
  /** 用户在参数条 / 付款卡上改过的那些值。 */
  parameters: Record<string, unknown>;
  /** 参考素材的规范 URL（连线 + 上传的有序数组，= 出站 reference 数组的顺序）。 */
  referenceUrls?: string[];
};

const REFERENCE_A = "https://assets.example.com/parity/character-a.png";
const mention = (url: string): string => `@[asset:${encodeURIComponent(url)}]`;

export const PARITY_REFERENCE_URL = REFERENCE_A;

export const PARITY_CASES: readonly ParityCase[] = [
  {
    id: "baseline-t2i",
    userStory: "①基线文生图：什么都不改，直接按生成。",
    vendorKey: "apimart",
    modelKey: "gpt-image-2",
    taskKind: "text_to_image",
    prompt: "a red paper crane on a windowsill",
    parameters: {},
  },
  {
    id: "param-override-2k",
    userStory: "②用户改过参数：清晰度 2K、画幅 16:9。",
    vendorKey: "apimart",
    modelKey: "gpt-image-2",
    taskKind: "text_to_image",
    prompt: "a red paper crane on a windowsill",
    // 只放这个模型**自己声明过**的旋钮（`gpt-image-2` 的档案 params = 比例 + 清晰度，
    // 线缆声明 = aspect_ratio / input_urls / model / resolution / size）。
    // 2026-09-21 合并时更正：本用例原先还带一个 `n: 2`（「数量」），而这个模型根本没有数量旋钮
    // ——界面上产生不出来。引擎 A 静默丢掉它，引擎 B 在参数表从声明派生之后当场拒编译，
    // 于是整个用例在两台上都测不成「改过的参数有没有原样上线」。
    // 那条「未声明的键：一台静默丢、一台硬拒」的差异是真的，但今天没有用户动作能产生它
    // （只有档案改版后残留的旧参数能），所以不在这张矩阵里冒充成一条分裂。
    parameters: { resolution: "2K", aspect_ratio: "16:9" },
  },
  {
    id: "prompt-mentions-reference",
    userStory: "③提示词里 @ 了一张参考图：供应商该收到它认识的写法，不是字面 @[asset:…]。",
    vendorKey: "apimart",
    modelKey: "gpt-image-2",
    taskKind: "image_edit",
    prompt: `让 ${mention(REFERENCE_A)} 走进画面右侧`,
    parameters: {},
    referenceUrls: [REFERENCE_A],
  },
  {
    id: "i2v-with-reference",
    userStory: "④带参考图的图生视频。",
    vendorKey: "apimart",
    modelKey: "doubao-seedance-2.5",
    taskKind: "image_to_video",
    prompt: "镜头缓缓推近，人物转身",
    parameters: {},
    referenceUrls: [REFERENCE_A],
  },
  {
    id: "variant-default-t2v",
    userStory: "⑤b 带变体的视频模型、用户没切变体（Seedance 2.0 默认 Fast）：每个入口派的都得是卡上写的那一档，不能有的发 standard。",
    vendorKey: "apimart",
    modelKey: "doubao-seedance-2.0",
    taskKind: "text_to_video",
    prompt: "一只橘猫在窗台上伸懒腰",
    parameters: {},
  },
  {
    id: "non-apimart-vendor",
    userStory: "⑤非 APIMart 供应商（内置 Higgsfield，鉴权方案词是 `Key` 不是 `Bearer`）。",
    vendorKey: "higgsfield",
    modelKey: "higgsfield-ai/soul/v2/standard",
    taskKind: "text_to_image",
    prompt: "a red paper crane on a windowsill",
    parameters: {},
  },
  {
    id: "unpriced-model",
    userStory: "⑥目录里算不出价的模型：出站逐字段同形，账本那一轴记「未知」不是 0（见 spendUnknownPriceParity）。",
    vendorKey: "apimart",
    modelKey: "z-image-turbo",
    taskKind: "text_to_image",
    prompt: "a red paper crane on a windowsill",
    parameters: {},
  },
];
