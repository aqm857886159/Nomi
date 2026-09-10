// propose 阶段的「谁来编译这份说明卡」裁决（从 integrationSession 抽出，2026-09-10）。
//
// 会话状态机只管 owner / revision / 阶段 / 收据；「Nomi 编不编得动、外部交回来的东西合不合格」
// 是另一个职责，而且它有自己的对手戏（providerAdapter 的编译器与校验器）。放在一起会让那份
// 被当作安全边界评审的文件继续膨胀，也让这条规则看起来像状态机的一个分支而不是一条独立不变量。
import { canHostPublicDocs } from "../providerAdapter/docsDiscovery";
import { draftFromSuppliedContract, parseAdapterSuppliedContract } from "../providerAdapter/agentCompileRequest";
import type { ProviderAdapterDraft, ProviderAdapterModelSelection } from "../providerAdapter/types";
import type { IntegrationCandidate, IntegrationCompileRequest, IntegrationSession } from "./integrationSession";
import { proposalRejected } from "./integrationProposalValidation";

const MAX_ADAPTER_DRAFT_TEXT = 512 * 1024;
const ADAPTER_PROVIDER_KINDS = new Set(["openai-compatible", "anthropic", "openai-responses"]);


/**
 * 这次接入需不需要「借 Nomi 已接的文本模型去读文档」。四种不需要：
 * 全是文本模型（接法固定，验证走 streamTextTask）、baseUrl 不合法、
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
  if (!canHostPublicDocs(hostname)) return undefined;
  // 本次选中的文本模型自己就能当编译器（key 已在手上），与 serviceLanguageModels 同一条判据。
  if (selections.some((item) => item.kind === "text")) return undefined;
  if (compilerAvailable()) return undefined;
  return {
    schemaVersion: 1,
    reasonCode: "adapter_contract_required",
    field: "proposal.adapterDraft",
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
