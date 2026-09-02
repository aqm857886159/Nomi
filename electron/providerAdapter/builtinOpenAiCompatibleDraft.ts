// 自建/局域网端点的内置接入契约（issue #62 / #4「无法添加本地模型」/ #43 ComfyUI 同源）。
//
// 正常接入流程是「抓这家的官方文档 → AI 编译出调用说明卡 → 真实验证 → 落库」，隐含前提是
// **这家有公开文档站**。用户填 192.168.x.x / 127.0.0.1（自建 ComfyUI、Ollama、vLLM、内网中转）
// 时前提不成立：不存在 docs.192.168.18.254 这个网站。旧实现不但去猜，还把 IP 当域名截成
// "18.254" 拼出 http://docs.18.254 → WHATWG 按 IPv4 解析失败 → Invalid URL → 整个接入判死禁用，
// 用户表现为「换 Key、换模型名、换端口都没用」。
//
// 这类端点几乎全是 OpenAI 兼容口（业界事实标准），说明卡是同一张、已知的——那就别猜文档也别叫 AI，
// 直接用内置模板。模板不另起一份：复用 catalog/newapiTransport 这张中转接入用了很久的单一真相源，
// 图生图协议、i2v 通道、参数键名那些血泪细节都在里面（P1 不造并行版）。
// 后半段不打折：仍然拿真实请求验过才启用，不假设它能用。
import { newapiImageEditProfileForModel, newapiTransportFor } from "../catalog/newapiTransport";
import { canHostPublicDocs } from "./docsDiscovery";
import { assertAdapterModeInvariants } from "./validator";
import type { BillingModelKind, HttpOperation, Model, Vendor } from "../catalog/types";
import type { AdapterAuthType, AdapterModeDraft, AdapterModelDraft, ProviderAdapterDraft } from "./types";
import type { AiSdkProviderKind } from "../catalog/types";

// 文本的 OpenAI 兼容 wire。声明它是为了让说明卡形状完整、也把线缆写明；实际文本请求走
// buildLanguageModelForVendor（AI SDK），验证也在 verifier 里短路成 streamTextTask，不发这条。
const OPENAI_COMPATIBLE_CHAT_OP: HttpOperation = {
  method: "POST",
  path: "/v1/chat/completions",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    model: "{{model.modelKey}}",
    messages: [{ role: "user", content: "{{request.prompt}}" }],
    stream: false,
  },
};

/**
 * Anthropic Messages contract (same line as onboardingIpc's protocol probe and buildAiSdkModel's
 * runtime): `POST {base}/v1/messages`, `x-api-key` + `anthropic-version`, and max_tokens is
 * required — omit it and Anthropic returns 400, it is not optional. The auth header is added by
 * withAuthHeader per authType; here we only declare the version header.
 */
const ANTHROPIC_CHAT_OP: HttpOperation = {
  method: "POST",
  path: "/v1/messages",
  headers: { "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
  body: {
    model: "{{model.modelKey}}",
    max_tokens: 16,
    messages: [{ role: "user", content: "{{request.prompt}}" }],
  },
};

type ParamControl = ReturnType<typeof newapiTransportFor>["params"][number];
type DraftParameters = NonNullable<AdapterModelDraft["parameters"]>;

/** ParamControl → 说明卡参数。image-url 类（视频首帧）说明卡形状不支持，丢弃即可：
 *  首帧实际由 taskParams 从节点连线聚合成 request.params.image_url，不依赖这个 UI 控件。 */
function toDraftParameters(params: readonly ParamControl[]): DraftParameters {
  const supported: DraftParameters = [];
  for (const param of params) {
    if (param.type !== "select" && param.type !== "number" && param.type !== "text" && param.type !== "boolean") continue;
    supported.push({
      key: param.key,
      label: param.label,
      type: param.type,
      ...(param.options.length > 0 ? { options: param.options } : {}),
      ...(param.defaultValue !== undefined ? { default: param.defaultValue } : {}),
      ...(param.min !== undefined ? { min: param.min } : {}),
      ...(param.max !== undefined ? { max: param.max } : {}),
    });
  }
  return supported;
}

// 按鉴权方式重写鉴权头。newapiTransport 的模板是给「中转站」写的，那边永远有 key，所以把
// `Authorization: Bearer {{user_api_key}}` 写死了。自建端点常常**根本不需要 key**（ComfyUI、
// Ollama、LM Studio 默认无鉴权）——照抄就会发出一个空的 `Authorization: Bearer `，有的服务直接拒。
// 鉴权头必须随 authType derive，不能钉死（接入矩阵测试跑出来的）。
function withAuthHeader(operation: HttpOperation, authType: AdapterAuthType): HttpOperation {
  const headers: Record<string, string> = { ...(operation.headers || {}) };
  delete headers.Authorization;
  if (authType === "bearer") headers.Authorization = "Bearer {{user_api_key}}";
  else if (authType === "x-api-key") headers["x-api-key"] = "{{user_api_key}}";
  // none：不带鉴权头。query：key 走查询参数，同样不该出现在头里。
  const next: HttpOperation = { ...operation };
  if (Object.keys(headers).length > 0) next.headers = headers;
  else delete next.headers;
  return next;
}

function modesForKind(
  kind: BillingModelKind,
  authType: AdapterAuthType,
  providerKind?: AiSdkProviderKind,
  modelKey?: string,
): AdapterModeDraft[] {
  // 没有文档出处就诚实留空——这张卡来自内置标准契约，不是从某个页面读出来的（D4 缺口明着标）。
  const noSources = { sourceUrls: [] as string[] };
  const auth = (operation: HttpOperation) => withAuthHeader(operation, authType);
  // 文字模型的验证通道必须**随协议 derive**，不能一律按 OpenAI 发。
  // anthropic 的聊天端点是 /v1/messages（不是 /chat/completions）且 max_tokens 必填，
  // 照 OpenAI 那份发过去只会 404 → 验证卡在 testing 直到 90s 超时，界面报「没有能力通过验证」，
  // 而连接检查本身是通的（那条路自己拼对了 /v1/messages）。2026-08-28 用户接 Claude 实测。
  if (kind === "text") {
    const operation = providerKind === "anthropic" ? ANTHROPIC_CHAT_OP : OPENAI_COMPATIBLE_CHAT_OP;
    return [{ taskKind: "chat", create: auth(operation), ...noSources }];
  }
  // 3D 没有通用 OpenAI 兼容契约 → 不编造。返回空 modes，验证阶段如实报「这个模型没有可用通道」。
  if (kind !== "image" && kind !== "video" && kind !== "audio") return [];
  const transport = newapiTransportFor(kind);
  const async = {
    ...(transport.query ? { query: auth(transport.query) } : {}),
    ...(transport.statusMapping ? { statusMapping: transport.statusMapping } : {}),
  };
  const modes: AdapterModeDraft[] = [{ taskKind: transport.taskKind, create: auth(transport.create), ...async, ...noSources }];
  // 图生图 / 图生视频各自注册一条：runtime 按 taskKind 选投递通道，缺了它连参考图的节点会被直接拒发。
  // 改图协议必须**按模型族 derive**，与接入落库路径（catalogCommit → newapiImageEditProfileForModel）同源：
  // newapiTransportFor("image").edit 恒是 chat/completions 多模态，但 gpt-image 系 / dall-e-2 的改图端点是
  // multipart /v1/images/edits。照 chat 那份发过去，中转如实回 400「This model is not supported on the Chat
  // Completions endpoint」→ image_edit 模式认证失败 → 该模型根本没有改图通道，连了参考图的节点被直接拒发，
  // 而这家中转其实完全支持改图。2026-09-03 自建中转 gpt-image-2 实测（真机 400 + 真机 multipart 200 双证）。
  //
  // referenceParam/referenceShape 必须声明：认证探针据此**注入一张参考图**（verifier.ts:144）。不声明就等于
  // 拿「零参考图」去验一条改图通道——multipart 端点直接抛「图生图缺参考图」，chat 那份则验的是纯文生图，
  // 两种都不是这条通道的真实用法。AI 编译路早被 validator.ts:299 强制声明，内置草稿绕过校验才漏到今天。
  // 键各随各自的 wire：改图三种协议都读聚合的 reference_images（数组）；图生视频 body 读的是首帧单值
  // image_url（newapiTransport.ts:211，那里注释写明不是裸 image 键）。写错键 = 探针注了参考却进不了报文。
  if (transport.edit) {
    const edit = kind === "image" ? newapiImageEditProfileForModel(modelKey || "").operation : transport.edit;
    modes.push({ taskKind: "image_edit", create: auth(edit), referenceParam: "reference_images", referenceShape: "array", ...noSources });
  }
  if (transport.imageToVideo) {
    modes.push({ taskKind: "image_to_video", create: auth(transport.imageToVideo), referenceParam: "image_url", referenceShape: "single", ...async, ...noSources });
  }
  return modes;
}

/** 主机可能有公开文档 → null（照走抓文档 + AI 编译）；不可能（IP/localhost/内网域）→ 内置说明卡。 */
export function builtinDraftForUndocumentedEndpoint(
  connection: { vendor: Vendor; models: readonly Model[] },
): ProviderAdapterDraft | null {
  const baseUrl = String(connection.vendor.baseUrlHint || "");
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return null; // 连 URL 都不合法 → 交给原路径如实报错，别在这里吞掉
  }
  if (canHostPublicDocs(hostname)) return null;
  return buildOpenAiCompatibleDraft({
    baseUrl,
    authType: (connection.vendor.authType || "bearer") as AdapterAuthType,
    ...(connection.vendor.providerKind ? { providerKind: connection.vendor.providerKind } : {}),
    models: connection.models.map((model) => ({ modelKey: model.modelKey, labelZh: model.labelZh, kind: model.kind })),
  });
}

export function buildOpenAiCompatibleDraft(input: {
  baseUrl: string;
  authType: AdapterAuthType;
  providerKind?: AiSdkProviderKind;
  models: ReadonlyArray<{ modelKey: string; labelZh: string; kind: BillingModelKind }>;
}): ProviderAdapterDraft {
  return {
    provider: {
      baseUrl: input.baseUrl,
      authType: input.authType,
      ...(input.providerKind ? { providerKind: input.providerKind } : {}),
    },
    sources: [],
    models: input.models.map((model): AdapterModelDraft => {
      const parameters =
        model.kind === "image" || model.kind === "video" || model.kind === "audio"
          ? toDraftParameters(newapiTransportFor(model.kind).params)
          : [];
      const draftModel: AdapterModelDraft = {
        modelKey: model.modelKey,
        labelZh: model.labelZh,
        kind: model.kind,
        ...(parameters.length > 0 ? { parameters } : {}),
        modes: modesForKind(model.kind, input.authType, input.providerKind, model.modelKey),
      };
      // 与 AI 编译路走**同一份**语义校验（P1 不留第二套判断）。此前这条路一次都没被校验过，
      // 「参考类模式必须声明 referenceParam/referenceShape」对它结构性失效 —— image_edit 漏声明
      // 多年没人拦，直到真中转实测才炸。线缆契约的声明缺失必须在构建期大声失败，不是运行期静默。
      // 出处类约束（sources/sourceUrls 非空）与 create 的 strict 形状不适用于内置卡，
      // 理由写在 assertAdapterModeInvariants 的注释里。
      assertAdapterModeInvariants(draftModel);
      return draftModel;
    }),
  };
}
