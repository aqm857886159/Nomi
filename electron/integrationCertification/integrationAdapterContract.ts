// propose 阶段的「谁来编译这份说明卡」裁决（从 integrationSession 抽出，2026-09-10）。
//
// 会话状态机只管 owner / revision / 阶段 / 收据；「Nomi 编不编得动、外部交回来的东西合不合格」
// 是另一个职责，而且它有自己的对手戏（providerAdapter 的编译器与校验器）。放在一起会让那份
// 被当作安全边界评审的文件继续膨胀，也让这条规则看起来像状态机的一个分支而不是一条独立不变量。
import { canHostPublicDocs } from "../providerAdapter/docsDiscovery";
import { AI_SDK_PROVIDER_KINDS } from '../shared/contracts/modelAccessCapabilities';
import { draftFromSuppliedContract, parseAdapterSuppliedContract } from "../providerAdapter/agentCompileRequest";
import type { ProviderAdapterDraft, ProviderAdapterModelSelection } from "../providerAdapter/types";
import type { AdapterAuthType } from "../providerAdapter/types";
import type { IntegrationCandidate, IntegrationSession } from "./integrationSession";

/**
 * 「这次要外部交卡」的交件说明。类型住这里，因为它由本文件的判据产生（`compileRequestFor`）。
 * `integrationSession.ts` 只 re-export 它，供既有 import 路径原样使用。
 */
export type IntegrationCompileRequest = {
  schemaVersion: 1;
  reasonCode: "adapter_contract_required" | "private_host_needs_declaration";
  field: "proposal.adapterDraft";
  provider: { baseUrl: string; authType: AdapterAuthType; providerKind?: string };
  models: Array<{ modelKey: string; kind: string }>;
  docs: { provided: boolean; bytes: number };
  /** `private_host_needs_declaration` 时给模型的那条出路（内置模板 id），不是我们替它选。 */
  suggestedTemplate?: string;
};
import { proposalRejected } from "./integrationProposalValidation";

const MAX_ADAPTER_DRAFT_TEXT = 512 * 1024;
const ADAPTER_PROVIDER_KINDS = new Set<string>(AI_SDK_PROVIDER_KINDS);


/**
 * 这次接入需不需要「借 Nomi 已接的文本模型去读文档」。四种不需要：
 * 全是文本模型（接法固定，跑起来走文本任务那一条模型调用）、baseUrl 不合法、
 * 自建/内网端点（走内置 OpenAI 兼容契约）、以及本机确实有可用的文本模型。
 */
export function compileRequestFor(
  session: IntegrationSession,
  selections: IntegrationCandidate[],
  compilerAvailable: () => boolean,
): IntegrationCompileRequest | undefined {
  const media = selections.filter((item) => item.kind !== "text");
  if (media.length === 0) return undefined;
  const baseUrl = session.config.baseUrl || "";
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
  // 自建 / 内网端点：**不再静默落回 OpenAI 兼容模板**（发现 4）。
  //
  // 两种 reasonCode 的差别：`adapter_contract_required` 是「本机没有可读文档的文本模型」（鸡生蛋）；
  // `private_host_needs_declaration` 是「这个端点的文档我们够不着」。以前后者返回 undefined，
  // 会话直接 ready_to_certify、套上 `builtinOpenAiCompatibleDraft`——于是「我们猜了一个形状」
  // 和「这家真的长这样」在界面上长得一模一样。09-18 拍板：模板变成 Agent **显式选**。
  // （设置页填表路不变：那是人在选「中转站」预设，他知道自己在选什么。）
  //
  // 外部驱动的那条路上，
  // 「我们猜了一个形状」与「这家真的长这样」必须能被分辨——把选择交回给交卡的那一方，
  // 并把内置模板 id 作为一条**明写的出路**递过去（它选，不是我们替它选）。
  // Nomi 内部编译器那条路（compilerAvailable）不受影响：那时本机有模型能真读文档。
  const privateHost = !canHostPublicDocs(hostname);
  // 本次选中的文本模型自己就能当编译器（key 已在手上），与 serviceLanguageModels 同一条判据。
  // 自建/内网端点这一支不看它：那里的问题是**文档够不着**，不是「谁来编译」。
  if (!privateHost && selections.some((item) => item.kind === "text")) return undefined;
  if (compilerAvailable()) return undefined;
  // 两种处境，同一份交件说明——只有 reasonCode 与「那条出路」不同（Ponytail 2026-09-18：
  // 一份 payload 抄两遍，改一个字段就得记得改两处）。
  return {
    schemaVersion: 1,
    reasonCode: privateHost ? "private_host_needs_declaration" : "adapter_contract_required",
    field: "proposal.adapterDraft",
    ...(privateHost ? { suggestedTemplate: "openai-compatible/chat-completions" } : {}),
    provider: {
      baseUrl,
      authType: session.config.authType || "bearer",
      ...(session.config.providerKind ? { providerKind: session.config.providerKind } : {}),
    },
    models: media.map((item) => ({ modelKey: item.modelKey, kind: item.kind })),
    docs: {
      provided: Boolean(session.config.docs),
      bytes: Buffer.byteLength(session.config.docs || "", "utf8"),
    },
  };
}

/** 外部交回的说明卡。身份由 Nomi 锁死，形状由 validateProviderAdapterDraft 判，没有旁路。 */
export function adapterDraftFromProposal(
  session: IntegrationSession,
  selections: IntegrationCandidate[],
  raw: unknown,
): ProviderAdapterDraft | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string" && raw.length > MAX_ADAPTER_DRAFT_TEXT)
    proposalRejected("proposal.adapterDraft", "is larger than the accepted contract size", "send only the selected models' modes and their supporting sources");
  const media = selections.filter((item) => item.kind !== "text");
  if (media.length === 0)
    proposalRejected("proposal.adapterDraft", "is not used by a text-only proposal", "drop adapterDraft, or select an image/video/audio/3D model");
  const providerKind = session.config.providerKind;
  try {
    return draftFromSuppliedContract({
      contract: parseAdapterSuppliedContract(raw),
      provider: {
        baseUrl: session.config.baseUrl || "",
        authType: session.config.authType || "bearer",
        ...(session.config.authHeader ? { authHeader: session.config.authHeader } : {}),
        ...(session.config.authQueryParam ? { authQueryParam: session.config.authQueryParam } : {}),
        ...(providerKind && ADAPTER_PROVIDER_KINDS.has(providerKind)
          ? { providerKind: providerKind as NonNullable<ProviderAdapterDraft["provider"]["providerKind"]> }
          : {}),
      },
      models: media.map((item) => ({
        modelKey: item.modelKey,
        kind: item.kind as ProviderAdapterModelSelection["kind"],
        ...(item.label ? { label: item.label } : {}),
      })),
    });
  } catch (error) {
    proposalRejected(
      "proposal.adapterDraft",
      "did not pass the adapter contract validator",
      `fix it and resubmit with the returned expectedRevision (${error instanceof Error ? error.message.slice(0, 400) : "invalid contract"})`,
    );
  }
}
