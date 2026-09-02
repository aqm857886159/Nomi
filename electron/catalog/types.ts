// Catalog 领域类型的单一真相源（从 runtime.ts 抽出 —— 评审 CTO/M1 + 审计 P0-3）。
// electron 内部各处（runtime / seedBuiltins / kieSeedance …）一处定义、各处 import，避免漂移。
// 渲染层不消费这些（electron 专用；渲染层有自己的 DTO，经 desktopClient 单源）。
import type { ApiKeyRecord } from "./secrets";
import type { ParamMap } from "./paramTranslate";
import catalogVersion from "./catalogVersion.json";
import {
  AI_SDK_PROVIDER_KINDS,
  ASSET_MEDIA_KINDS,
  BILLING_MODEL_KINDS,
  PROFILE_KINDS,
  VENDOR_AUTH_TYPES,
} from "../shared/contracts/modelAccessCapabilities";

// 这些值的单一真相源是 electron/shared/contracts/modelAccessCapabilities（可枚举、可被旅程门岗读取）；
// 运行时类型从常量反推，避免手写 union 落后于真实能力面。
export { AI_SDK_PROVIDER_KINDS, ASSET_MEDIA_KINDS, BILLING_MODEL_KINDS, PROFILE_KINDS, VENDOR_AUTH_TYPES };
export type BillingModelKind = (typeof BILLING_MODEL_KINDS)[number];
export type ProfileKind = (typeof PROFILE_KINDS)[number];

// openai-responses：OpenAI Responses API（/responses，非 /chat/completions）。
// 中转（如 foxcode codex 渠道 wire_api=responses）只认 Responses → chat/completions 会 502（2026-06-06 实测根因）。
export type AiSdkProviderKind = (typeof AI_SDK_PROVIDER_KINDS)[number];

/**
 * 供应商「怎么吞本地素材」的声明(R1,通用第一)。本地素材(nomi-local://)只有 app 自己能读,
 * vendor 服务器够不着;发送前必须按 vendor 声明的策略把它变成可达值。通用解析器据此分叉,
 * 加新 vendor = 多声明一份,通用层不改。
 *  - inline-base64：直接把 data:URI 塞进 body(无需上传)。
 *  - upload-url   ：把字节传到 vendor 文件接口 → 拿回临时公网 URL → 填进 body。
 *  - upload-stream：multipart 流式上传(二进制,大文件高效)→ 拿回临时公网 URL。用于视频 mp4
 *                   (KIE file-stream-upload),base64 对 mp4 低效/受限。
 *  - upload-presigned：先向 vendor 创建一次性上传声明，再把字节 multipart 传到返回的
 *                      uploadUrl，最后使用 vendor 自己的 URI（如 runway://），不依赖公共图床。
 *  - none         ：vendor 只收公网 URL 且无上传通道 → 明确报错(不静默失败)。
 *
 * `accepts`：该通道接受的媒体类型(image/video/audio)。缺省视为 ['image']——今天的通道都面向图片
 * (apimart 的 /uploads/images 仅图片)。视频素材必须路由到声明 'video' 的通道(如 KIE 通用文件托管)。
 */
export type AssetMediaKind = (typeof ASSET_MEDIA_KINDS)[number];
export type VendorAuthType = (typeof VENDOR_AUTH_TYPES)[number];

export type AssetIngestion =
  | { strategy: "inline-base64"; accepts?: ReadonlyArray<AssetMediaKind>; visibility?: "provider-private"; ttlSeconds?: number }
  | { strategy: "none"; accepts?: ReadonlyArray<AssetMediaKind>; visibility?: "provider-private"; ttlSeconds?: number }
  | {
      /**
       * 两步供应商自有上传：POST 初始化 JSON → POST 预签名 uploadUrl → 返回供应商 URI。
       * 初始化与实际字节上传分开，故 uploadUrl 请求不携带 API key；只把初始化请求的
       * Authorization 交给供应商。Runway Dev 的 POST /v1/uploads(type=ephemeral) 使用此形状。
       */
      strategy: "upload-presigned";
      /** 初始化端点（完整 URL）。 */
      endpoint: string;
      /** 初始化响应里的实际上传 URL。 */
      uploadUrlPath: string;
      /** 初始化响应里的供应商 URI（如 runwayUri）。 */
      uriPath: string;
      /** 初始化响应里传给 multipart 的字段对象，默认 `fields`。 */
      fieldsPath?: string;
      /** 初始化请求的固定字段（动态文件名/type 会由解析器补上）。 */
      initFields?: Record<string, string>;
      /** 初始化请求的固定协议头（例如 Runway 的 X-Runway-Version）。 */
      initHeaders?: Record<string, string>;
      filenameField?: string;
      typeField?: string;
      uploadFileField?: string;
      accepts?: ReadonlyArray<AssetMediaKind>;
      visibility?: "provider-private";
      ttlSeconds?: number;
      requiresConsent?: false;
    }
  | {
      strategy: "upload-stream";
      /** 上传端点(完整 URL)。multipart/form-data,file 字段为二进制,另带 uploadPath/fileName。 */
      endpoint: string;
      /** 目录字段名(默认 "uploadPath")。 */
      uploadPathField?: string;
      uploadPath?: string;
      /** 文件名字段名(默认 "fileName")。 */
      fileNameField?: string;
      /** 响应里公网 URL 的点路径(如 KIE 的 "data.downloadUrl")。 */
      urlPath: string;
      /** 鉴权:复用 vendor 的 api key(默认 bearer)。 */
      authType?: "bearer" | "key";
      /** 该通道接受的媒体类型;缺省 ['image']。 */
      accepts?: ReadonlyArray<AssetMediaKind>;
      visibility?: "provider-private";
      ttlSeconds?: number;
      requiresConsent?: false;
    }
  | {
      strategy: "upload-url";
      accepts?: ReadonlyArray<AssetMediaKind>;
      /** 上传端点(完整 URL)。 */
      endpoint: string;
      method?: string;
      /** base64 字段名(如 kie 的 "base64Data")。 */
      base64Field: string;
      /** 是否带 data:URI 前缀(默认 true);false = 纯 base64。 */
      dataUrlPrefix?: boolean;
      /** 可选:目录字段名 + 值。 */
      uploadPathField?: string;
      uploadPath?: string;
      /** 可选:文件名字段名。 */
      fileNameField?: string;
      /** 响应里公网 URL 的点路径(如 kie 的 "data.downloadUrl")。 */
      urlPath: string;
      /** 鉴权:复用 vendor 的 api key(默认 bearer)。 */
      authType?: "bearer" | "key";
      visibility?: "provider-private";
      ttlSeconds?: number;
      requiresConsent?: false;
    }
  | {
      strategy: "upload-multipart";
      /** 上传端点(完整 URL)。multipart/form-data，file 字段为二进制。 */
      endpoint: string;
      /**
       * 响应里公网 URL 的点路径(如 apimart 的 "url")。
       * 当 responseIsPlainTextUrl 为 true 时整个响应体即 URL,此字段可省。
       */
      urlPath?: string;
      /**
       * 响应体是否为纯文本 URL(整个 body trim 后即直链,非 JSON)。
       * 用于 litterbox/catbox 这类匿名临时文件托管(响应 = "https://litter.catbox.moe/abc.mp4")。
       * 缺省 false → 按 JSON + urlPath 读取。
       */
      responseIsPlainTextUrl?: boolean;
      /** file 字段名(默认 "file")。litterbox 用 "fileToUpload"。 */
      fileField?: string;
      /** multipart 里除 file 外的固定文本字段(如 litterbox 的 reqtype=fileupload & time=24h)。 */
      extraFields?: Record<string, string>;
      /**
       * 可选:提取出 URL 后再做一次纯字符串替换。
       * 某些托管(tmpfiles.org)JSON 里给的是**页面 URL**,真正的直链需把 host 后插入 "/dl/"
       * (tmpfiles.org/<id>/<name> → tmpfiles.org/dl/<id>/<name>),否则 vendor fetch 到的是 HTML 页。
       * tmpfiles 用 { search: "tmpfiles.org/", replace: "tmpfiles.org/dl/" }。
       */
      urlTransform?: { search: string; replace: string };
      /** 鉴权:复用 vendor 的 api key(默认 bearer)。无 key 时不发 Authorization。 */
      authType?: "bearer" | "key";
      /** 该通道接受的媒体类型;缺省 ['image']。 */
      accepts?: ReadonlyArray<AssetMediaKind>;
      visibility?: "provider-private" | "public-provider" | "public-anonymous";
      ttlSeconds?: number;
      requiresConsent?: boolean;
    }
  | {
      /**
       * 两阶段上传：先用 JSON 初始化，再把本地字节 PUT 到供应商返回的 signed URL。
       * fal CDN 使用此形状；signed URL 本身不带供应商 API key。
       */
      strategy: "upload-initiate-put";
      endpoint: string;
      initFileNameField?: string;
      initContentTypeField?: string;
      uploadUrlPath: string;
      urlPath: string;
      authType?: "bearer" | "key";
      accepts?: ReadonlyArray<AssetMediaKind>;
      visibility?: "provider-private" | "public-provider";
      ttlSeconds?: number;
      requiresConsent?: false;
    }
  | {
      /**
       * 两阶段上传：先初始化 multipart 表单，再把初始化返回的 fields + file POST 到 signed URL。
       * Runway ephemeral upload 使用此形状，并返回只能给 Runway 使用的 runway:// URI。
       */
      strategy: "upload-initiate-multipart";
      endpoint: string;
      uploadUrlPath: string;
      fieldsPath: string;
      uriPath: string;
      fileField?: string;
      initFileNameField?: string;
      initTypeField?: string;
      initType?: string;
      authType?: "bearer" | "key";
      accepts?: ReadonlyArray<AssetMediaKind>;
      visibility?: "provider-private" | "public-provider";
      ttlSeconds?: number;
      requiresConsent?: false;
    }
  | {
      /**
       * 本地 ComfyUI：POST /upload/image（multipart，file 字段名 "image"）把本地图传进 ComfyUI 的 input 目录，
       * 取回 { name, subfolder, type } → 返回**文件名**（subfolder ? "subfolder/name" : name）给 LoadImage 的
       * image 输入（LoadImage 只认 input 目录里的文件名、不认公网 URL，故也要跳过 trustedOriginalUrl 快路）。
       * 端点由 vendor baseUrl 动态派生（用户可改地址）。实查 docs.comfy.org/api-reference + Comfy-Org server.py 2026-07。
       */
      strategy: "comfyui-upload";
      /** 完整上传端点，如 http://127.0.0.1:8188/upload/image。 */
      endpoint: string;
      accepts?: ReadonlyArray<AssetMediaKind>;
      visibility?: "provider-private";
      ttlSeconds?: number;
    }
  | {
      /**
       * 匿名上传 fallback 链:按顺序逐个 host 试,谁先返回合法 http(s) URL 就用谁。
       * 用于"零配置兜底"——bake-in 的免 key 免账号公共托管(litterbox → tmpfiles…),
       * 单 host 限速/宕机/封禁时自动切下一个,全失败才抛诚实错误。每个 chain 项都是
       * 一个普通 upload-multipart 声明(无 key),由 resolveLocalAsset 逐个 try/catch 执行。
       */
      strategy: "anon-chain";
      chain: ReadonlyArray<AssetIngestion>;
      /** 该链接受的媒体类型;缺省 ['image']。匿名 host 收任意文件,声明全媒体类型。 */
      accepts?: ReadonlyArray<AssetMediaKind>;
      visibility?: "public-anonymous";
      ttlSeconds?: number;
      requiresConsent?: true;
    };

/** 本地 ComfyUI **第一台**的固定 key（种子 + assetLocalization 识别它走自己的 /upload/image，单源防漂移）。 */
export const COMFYUI_VENDOR_KEY = "comfyui-local";
/** 第 2+ 台 ComfyUI 的 key 前缀（`comfyui-local-工作站` 等）。见 docs/plan/2026-08-01-comfyui-multi-instance.md。 */
export const COMFYUI_VENDOR_KEY_PREFIX = `${COMFYUI_VENDOR_KEY}-`;

/**
 * 「这个 vendor 是不是一台 ComfyUI」——多实例的**唯一判据**（P4 通用：判类不判具体哪台）。
 * 用 key 前缀而非 meta 标记：key 是稳定身份、不会被 upsert 覆盖，且存量单实例天然是第一台（零迁移）。
 * 注意各处仍必须用 vendor **自己的** baseUrlHint（信任/连接/对账都按实例走），本判据只回答"是不是"。
 */
export function isComfyuiVendor(vendor: { key?: string } | null | undefined): boolean {
  const key = vendor?.key;
  return typeof key === "string" && (key === COMFYUI_VENDOR_KEY || key.startsWith(COMFYUI_VENDOR_KEY_PREFIX));
}

export type Vendor = {
  key: string;
  name: string;
  enabled: boolean;
  hasApiKey?: boolean;
  baseUrlHint?: string | null;
  authType?: VendorAuthType;
  authHeader?: string | null;
  authQueryParam?: string | null;
  /**
   * Which Vercel AI SDK provider implementation to use for this vendor.
   * Optional; absent / unknown values fall back to "openai-compatible"
   * so existing model-catalog.json files keep working without migration.
   */
  providerKind?: AiSdkProviderKind;
  /** Optional per-connection egress. Empty/absent preserves the application-level route. */
  network?: { proxyUrl?: string };
  /** R1:本地素材吞入策略。curated vendor 也可由代码注册表兜底(见 assetLocalization.curatedAssetIngestion)。 */
  assetIngestion?: AssetIngestion;
  meta?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type Model = {
  modelKey: string;
  vendorKey: string;
  modelAlias?: string | null;
  labelZh: string;
  kind: BillingModelKind;
  enabled: boolean;
  meta?: unknown;
  /**
   * 自定义调用脚本（用户数据，2026-08-04 拍板）：存在即整体接管该模型的请求构造/轮询/响应解析
   * （runtime.runTask 单一派发点，先于 mapping）。与 enabled 同级的用户配置——拉取/重接入的
   * upsert 不得清掉它（applyModelUpsert：undefined=保留，null=显式删除）。
   */
  customCall?: {
    /** 模型级兼容脚本：没有当前模式专用脚本时回退到这里。 */
    script?: string;
    /** 模式级覆盖：key 必须是该模型显式能力契约 / ModelArchetype 中的 mode id。 */
    modes?: Record<string, { script: string; updatedAt: string }>;
    updatedAt: string;
  };
  pricing?: {
    cost: number;
    enabled: boolean;
    createdAt?: string;
    updatedAt?: string;
    specCosts: Array<{ specKey: string; cost: number; enabled: boolean; createdAt?: string; updatedAt?: string }>;
  };
  /**
   * Catalog v2+: present when this model was produced by the onboarding agent.
   * Carries the doc-quote evidence per parameter so we can audit / re-trial later.
   */
  onboarding?: {
    addedVia: "agent" | "manual";
    trialId?: string;
    docsUrl?: string;
    addedAt: string;
    fields: Array<{
      key: string;
      displayName: string;
      type: "select" | "number" | "text" | "boolean" | "image-url";
      options?: Array<{ value: string; label: string }>;
      default?: string;
      evidence: {
        field: string;
        evidence: string;
        evidence_location: string;
        confidence: "high" | "medium" | "low";
      };
    }>;
  };
  createdAt: string;
  updatedAt: string;
};

/**
 * A single HTTP call template: method + path (relative to vendor.baseUrl, or
 * absolute), headers, query, body. String values may contain `{{...}}`
 * placeholders resolved by `renderTemplateValue` against the request context.
 * `response_mapping` / `provider_meta_mapping` describe how to read the
 * upstream response (used by `buildProfileTaskResult`).
 */
export type HttpOperation = {
  method: string;
  path: string;
  /**
   * 路径从**主机根**拼，而不是从 vendor 的 baseUrl 拼。默认（缺省）= 从 baseUrl 拼。
   *
   * 为什么需要：某些厂商的原生端点不在 OpenAI 兼容的 /v1 命名空间下（火山方舟是
   * `/api/v3/contents/generations/tasks`）。中转用户常把接入地址填成 `https://host:8443/v1`
   * （拉模型要那个地址），直接拼就成了 `/v1/api/v3/...` 打不中。置位后 buildHttpRequest 先剥掉
   * baseUrl 尾部的版本段（/v1、/v3、…）再 join。显式声明，不在 joinUrl 里塞按路径猜的魔法。
   */
  pathFrom?: "host-root";
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  response_mapping?: Record<string, unknown>;
  provider_meta_mapping?: Record<string, unknown>;
  /**
   * **命名响应变换**（P4 声明驱动，不 hardcode vendor 进 runtime）。当上游响应形状不是点路径
   * response_mapping 能直接读的（如 ComfyUI /history：顶层键是动态 prompt_id、取图要从
   * filename+subfolder+type 拼 /view URL），声明一个已注册的变换名，buildProfileTaskResult 会在跑
   * response_mapping **之前**对 raw response 应用它、归一成稳定形状。变换住各自 vendor 模块、注册进
   * electron/tasks/responseTransforms.ts，runtime 只按名查表、不含 vendor 逻辑。
   */
  response_transform?: string;
  /**
   * **命名请求变换**（与 response_transform 对称）。模板渲染完、发 HTTP 前对 body 应用一次，
   * 用于「按目标后端实况补全请求」（如 ComfyUI 内置文生图 ckpt_name 留空 → 从本机 /object_info
   * derive 第一个 checkpoint）。变换住各自 vendor 模块、注册进 electron/tasks/requestTransforms.ts；
   * 与响应变换的刻意差异：变换抛错会冒泡（fail fast 拦下必失败的提交并给人话），见该文件头。
   */
  request_transform?: string;
  /**
   * **wire 必填参数的兜底默认值**（headless/MCP 路专用）。UI 路由 NodeGenerationComposer 会按档案
   * (src/config/modelArchetypes) 把用户选的 size/voice/model 等填进 request.params；但 MCP/CLI 的
   * `generate` 不经 UI、调用方也无从知道每家 vendor 的必填参数（nomi_generate 根本不暴露 params）。
   * 缺这些参数时 vendor 直接拒（实测：火山 Seedream 缺 size→HTTP 400；apimart TTS 缺 model→HTTP 500；
   * 豆包语音缺 voice→「未选择音色」）。runtime.runTask 解析出 mapping 后，把这里的默认值**合并到
   * request.extras 之下（既有值优先）**——UI 路因为已填值故零影响，headless 路得到一份能成的请求。
   * 注：值与档案默认有小重叠（不同层：档案=UI 控件默认；这里=headless wire 下限），改档案默认时一并核对此处。
   */
  defaultParams?: Record<string, unknown>;
  /**
   * 音频 create op 的**响应形状声明**（仅 audioTaskRunner 消费，P4 声明驱动不 hardcode vendor）。
   *  - 缺省 / "binary"      ：响应体即裸音频字节（OpenAI 兼容 /v1/audio/speech，现有行为）。
   *  - "ndjson-base64"      ：NDJSON 流（逐行 {code,data}，code===0 时 data 为 base64 音频块，
   *                           code===20000000 收尾）——豆包语音 /api/v3/tts/unidirectional。
   * 任何未来同形状的 vendor 声明此值即复用解码，无需碰 runtime（runTextToSpeech 按它分流）。
   */
  audioResponse?:
    | "binary"
    | "ndjson-base64"
    | {
        /** The response body is the generated audio bytes. */
        type: "binary";
        contentType: string;
        extension: string;
      }
    | {
        /** The response is JSON and the declared dot path contains encoded audio bytes. */
        type: "json";
        dataPath: string;
        encoding: "hex" | "base64";
        contentType: string;
        extension: string;
      };
  /**
   * **进程型 transport 声明**（仅 processOperation 消费，P4 声明驱动不 hardcode vendor）。
   * 当一个 vendor 不是 HTTP 端点而是本地 CLI 二进制（如即梦官方 `dreamina`）时，create/query op
   * 各自声明 process，runtime 的 executeProfileOperation 顶部据此分流到 spawn 分支（而非 requestJson）：
   * spawn `bin` + 渲染后的 `args`（含 `{{...}}` 占位，与 body 同一套 renderTemplateValue），按 `parser`
   * 把 stdout 归一成「类 HTTP 响应」对象，喂回现有 buildProfileTaskResult/statusMapping，状态机零改。
   *  - bin            ：可执行名（运行时经 PATH / env 解析真实路径）。
   *  - args           ：参数模板数组（如 ["text2video","--prompt={{prompt}}","--duration={{params.duration}}"]）。
   *  - parser         ：stdout 解码器选择子（如 "dreamina-cli" / "codex-cli-image"）。未来同形状 vendor 声明各自 parser 即复用。
   *  - appendDownloadDir：true 时追加 `--download_dir=<项目素材临时目录>`，让 CLI 把结果下到本地（取本地文件）。
   *  - fileParams     ：**输入文件吞入声明**。即梦带图/视频/音频的命令收**本地文件路径**（`--image=./x.png`），
   *                     而 Nomi 槽给的是资产 URL（nomi-local://http/data）。spawn 前据此把每个输入 URL 物化成
   *                     本地路径（nomi-local 零拷贝取现成绝对路径；http/data 下到 temp，spawn 后清理），按 mode
   *                     暴露成 args 模板可读的 expose 参数：single=单路径 / csv=逗号串 / repeat=`flag=path` 数组（spread）。
   */
  process?: {
    bin: string;
    args: string[];
    parser: "dreamina-cli" | "codex-cli-image" | "antigravity-cli-image";
    appendDownloadDir?: boolean;
    /**
     * 特殊 arg 构建器（声明驱动分派）。缺省=用 `args` 模板渲染。"multiframe"=多帧按图数变形（2 图 shorthand /
     * 3+ 图 N-1 个 --transition-prompt），逻辑在 dreaminaCodec.buildMultiframeArgs（纯函数可测），processOperation
     * 据此忽略 args、改调构建器。其余 6 个模式都走通用 args 模板，唯独多帧条数随输入变、模板表达不了。
     */
    build?: "multiframe";
    fileParams?: Array<{
      /** request.params 里持有输入资产 URL（string 或 string[]）的键（= 槽 inputKey）。 */
      param: string;
      /** 物化后写回 request.params 的键（被 args 模板 `{{request.params.<expose>}}` 引用）。 */
      expose: string;
      /** single=取首个路径；csv=逗号连接；repeat=`flag=path` 字符串数组（exact 模板 spread）；array=原样路径数组（多帧 build 直接读）。 */
      mode: "single" | "csv" | "repeat" | "array";
      /** mode=repeat 时的 flag 名（如 "--image"）。 */
      flag?: string;
    }>;
  };
  /**
   * **multipart/form-data transport 声明**（P4 声明驱动不 hardcode vendor）。当端点收的是二进制文件上传
   * 而非 URL-in-JSON（OpenAI 官方 /v1/images/edits 图生图：image[] 文件字段 + 文本字段），create op 声明
   * multipart，executeProfileOperation 据此分流到 FormData 分支（而非 requestJson）：
   *  - fields      ：文本 form 字段（值走 renderTemplateValue，与 body 同一套模板）。undefined/空值丢弃。
   *  - imageField  ：二进制图片文件字段名（多图 "image[]" / 单图 "image"）。
   *  - imageSource ：解析出参考图 URL（string 或 string[]）的模板；发送时把每个 URL 取成字节当文件上传
   *                  （nomi-local 读本地字节零网络；http/data 取字节）。
   *  - multiple    ：true=多图（每 URL 一个 imageField 项）；false=只取首图。
   *  - filename    ：上传文件名前缀（默认 "image"）。
   * 可序列化（持久化进 catalog JSON）：纯数据模板。
   */
  multipart?: {
    fields?: Record<string, string>;
    /** Generic file declaration used by image, audio, and video upload endpoints. */
    fileField?: string;
    fileSource?: string;
    fileKind?: "image" | "audio" | "video";
    /** Legacy image-only aliases retained for existing catalog rows. */
    imageField?: string;
    imageSource?: string;
    multiple?: boolean;
    filename?: string;
  };
  /**
   * 参数翻译表（铁律：模型身份决定参数，与渠道无关）。档案声明**中性 canonical 参数**（全站一致），
   * 这里把它们翻译成本 codec 的 wire 字段（改名 / 值转换 / 显式 drop）——见 paramTranslate.ts。
   * runtime 渲染 body 前 applyParamMap 注入 wire 键。**改名/identity 透传不必写**（canonical 键 =
   * body 读的键时，值经 ...extras 直达）；只在 wire≠canonical 或要算值（如比例+档位→OpenAI 像素）时写。
   * 可序列化（持久化进 catalog JSON）：规则纯数据，值转换用 PARAM_TRANSFORMS 的字符串 id 引用。
   */
  paramMap?: ParamMap;
};

/**
 * One (vendor, taskKind) → one mapping row. `create` initiates the task,
 * `query` observes an async task, and optional `result` fetches endpoint-specific
 * output after the observation reaches a successful terminal state.
 * Vendors that map their status strings to ours can use `statusMapping`
 * (e.g. `{ succeeded: ["completed", "done"] }`).
 */
export type Mapping = {
  id: string;
  vendorKey: string;
  taskKind: ProfileKind;
  /**
   * 可选：把这条 mapping 绑定到**特定模型**。缺省（generic）= 该 (vendor, taskKind) 桶的通用模板，
   * 多个模型共享（如 Seedance + Fast 共用一条 image_to_video）。当同一 vendor 下两个模型的**同一 taskKind
   * 需要不同请求形状**时（如 kie 的 HappyHorse 与 Kling 都是 text_to_video，但 body 字段不同），各自带
   * modelKey 区分，避免「按 (vendor,taskKind) 找 mapping 时第一个赢、另一个静默套错模板」。
   * 选择优先级见 selectTaskMapping：精确 modelKey > generic（无 modelKey）。无匹配返回 null
   * （不再「任意 enabled 兜底」静默套别的模型模板）。
   */
  modelKey?: string;
  /** Optional archetype mode discriminator. A mapping may share one model row while
   * exposing different transport contracts for its modes (for example Suno music,
   * upload-extend and upload-cover). */
  modeId?: string;
  name: string;
  enabled: boolean;
  create: HttpOperation;
  query?: HttpOperation;
  result?: HttpOperation;
  statusMapping?: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
};

/**
 * 纯函数：在一组 mapping 里选出该 (vendor, taskKind, modelKey) 该用的那条。
 * 优先级：① 精确绑定该 modelKey 的 → ② generic（无 modelKey）。
 *
 * P3 根治（去掉「③ 任意 enabled 兜底」）：旧实现在无精确绑定 + 无 generic 时直接返回
 * `inBucket[0]`，会把当前 modelKey 静默套上桶里**另一个模型**的请求模板（body 字段全错），
 * 用户看到的是「莫名其妙的请求形状/参数」而非清晰的「该模型没配 mapping」。改为返回 null，
 * 让调用方（runtime.findTaskMapping）据此走通用回退/明确报错，绝不张冠李戴。
 * 向后兼容仍由「② generic（无 modelKey）」覆盖：老数据 Seedance 那条没带 modelKey 即 generic，
 * 任何 modelKey 都能命中，不受本次收紧影响。
 * 抽成纯函数是为了可单测（runtime.findTaskMapping 读 catalog 后调它）。
 */
export function selectTaskMapping(
  mappings: Mapping[],
  vendorKey: string,
  taskKind: ProfileKind,
  modelKey?: string,
  modeId?: string,
): Mapping | null {
  const inBucket = mappings.filter((m) => m.enabled && m.vendorKey === vendorKey && m.taskKind === taskKind);
  if (inBucket.length === 0) return null;
  const key = (modelKey || "").trim();
  const exact = key ? inBucket.filter((m) => (m.modelKey || "").trim() === key) : [];
  const generic = inBucket.filter((m) => !m.modelKey);
  // Exact model bindings win. When there is no exact binding, retain the
  // legacy generic template fallback; never borrow another model's wire shape.
  const candidates = exact.length > 0 ? exact : generic;
  if (candidates.length === 0) return null;
  const requestedMode = (modeId || "").trim();
  if (requestedMode) {
    const exactMode = candidates.filter((m) => (m.modeId || "").trim() === requestedMode);
    if (exactMode.length === 1) return exactMode[0];
    // A single **mode-less** candidate can safely serve several UI modes: that is the
    // designed shared-wire case (one vendor endpoint behind several UI modes, and older
    // rows predate modeId entirely). A single candidate that declares a **different**
    // mode must never be borrowed — its body is that other mode's contract, so the
    // requested mode's reference keys are simply absent and the request silently
    // degrades to the other mode's shape. That is how `runway/happyhorse_1_0/reference`
    // (declares 10 reference images) quietly became "one promptImage", and how three fal
    // modes borrowed a sibling's wire. Fail closed instead; the caller surfaces the gap.
    const onlyCandidateIsModeless = candidates.length === 1 && !(candidates[0].modeId || "").trim();
    return exactMode.length === 0 && onlyCandidateIsModeless ? candidates[0] : null;
  }
  // Once a model has multiple mode-specific mappings, an omitted mode is
  // ambiguous and must fail closed instead of silently selecting the first row.
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * 纯函数：在一组 model 里选出该 (vendor, modelKey/alias, kind) 该执行的那个。
 * **精确 modelKey 优先于 alias**（P1·修双键 OR 误路由根因）：旧实现用
 * `modelKey===k || modelAlias===k` 单条 OR，当「A 的 alias 撞 B 的 key」时会按
 * 数组序把 B 误选成 A。这里先扫精确 key，无果再扫 alias —— 精确身份永远赢。
 * 只认 enabled + 同 vendor；kind 给定时一并过滤。无匹配返回 undefined。
 * 抽成纯函数是为了可单测（runtime.findExecutableModel 读 catalog 后调它）。
 */
export function selectExecutableModel(
  models: Model[],
  vendorKey: string,
  modelKey: string,
  kind?: BillingModelKind,
): Model | undefined {
  const inBucket = models.filter(
    (m) => m.vendorKey === vendorKey && m.enabled && (!kind || m.kind === kind),
  );
  return (
    inBucket.find((m) => m.modelKey === modelKey) ||
    inBucket.find((m) => m.modelAlias === modelKey)
  );
}

/** ProfileKind → 计费/目录口径（纯查表；从 runtime 下沉，R12 巨壳净减，runtime re-export 保 API）。 */
export function billingKindForTaskKind(kind: ProfileKind): BillingModelKind {
  if (kind === "text_to_video" || kind === "image_to_video") return "video";
  if (kind === "chat" || kind === "prompt_refine" || kind === "image_to_prompt") return "text";
  if (kind === "text_to_audio" || kind === "image_to_audio" || kind === "transcribe") return "audio"; // 音频族走第四路同步收口
  if (kind === "text_to_3d" || kind === "image_to_3d") return "model3d"; // 3D 族（RunningHub 混元/HiTem/Meshy，输出 glb）
  return "image";
}

/** Catalog version.
 *  v2 added Model.onboarding + ApiKeyRecord.enc.
 *  v3 collapsed Mapping.{requestMapping,responseMapping} (which used to wrap
 *  things in a v2 envelope `{version, create:{default}, query:{default}}`) into
 *  flat Mapping.{create,query} HttpOperation fields. Old rows are normalized
 *  in `migrateCatalogForward`.
 */
/*  v4 给自建中转(relay)的旧图像/视频 op 补「中性参数→线缆字段」翻译表(paramMap)——存量用户已接入的
 *  OpenAI 兼容中转其 op 是迁移前持久化的(读 size 像素却无 paramMap)，档案中性化后比例/清晰度发不出去。
 *  见 docs/plan/2026-06-24-model-param-consistency-invariant.md。 */
/*  v5 给存量中转 image 条目补图生图能力(image_edit mapping + supportsReferenceImages + 老标准参数升级成
 *  比例/清晰度)。8c711f0c 起新接入才写这些字段，老条目此前只能「删了重加」——迁移根治，见
 *  docs/plan/2026-07-06-i2i-reference-reliability.md（L1）。只碰非内置 vendor + OpenAI 兼容形状。 */
/*  v6 把 image_edit 从 vendor 级单协议升级为 modelKey 精确协议：Grok Imagine 的 JSON /images/edits
 *  不再误走 Nano Banana 的 /chat/completions；存量目录自动补精确 mapping。 */
/*  v7 重跑 v6 的协议分流（v6 那次跑在 gpt-image/dall-e-2 接上 multipart edits 之前，存量被留在
 *  chat/completions）。迁移幂等，靠 bump 强制重跑。 */
/*  v8 给存量中转 video 条目补「图生视频」通道(image_to_video mapping)。接入路径此前只建 text_to_video，
 *  视频节点一连参考图/首帧就报「没有配置图生视频通道·请删除后重新接入」，而重接也不会建（根因在接入
 *  路径，已同 commit 修）。只碰非内置 vendor + /video/generations 形状。 */
/*  v9 moves custom-call named configuration out of vendor.meta and into the
 *  existing safeStorage-backed vendor credential record. */
/* v10 corrects stored ComfyUI model/output/task contracts from the selected file output. */
/* v11 repairs provable stored ComfyUI media-role violations: image placeholders in numeric widgets. */
/* v12 moves credential-bearing connection network config (proxyUrl, which may carry user:pass, and
 *  extraHeaders, which may carry Authorization) out of the plaintext vendor row into the existing
 *  safeStorage-backed vendor credential record. Legacy plaintext stays readable until an explicit
 *  vendor write migrates every secret atomically (mirrors the v8→v9 customConfig deferral). */
export type CatalogVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export const CURRENT_CATALOG_VERSION: CatalogVersion = catalogVersion.current as CatalogVersion;

export type CatalogState = {
  version: CatalogVersion;
  vendors: Vendor[];
  models: Model[];
  mappings: Mapping[];
  apiKeysByVendor: Record<string, ApiKeyRecord>;
};
