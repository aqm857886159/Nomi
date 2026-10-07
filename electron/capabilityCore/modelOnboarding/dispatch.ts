/**
 * 接模型工具面的**执行层**（方案 §4.2）。
 *
 * ── 它是投影，不是第二个状态机 ────────────────────────────────────────────────────────
 * 底座仍是 `IntegrationSessionService`（owner / revision / 阶段词表 / 看门狗 / 迁移都在那），
 * `setupId` 就是它的 session id。这里只做三件事：
 *   ① 把「一种后果一跳」的动词映射到底座已有的那几步（begin+open_credentials / propose+start / cancel）；
 *   ② `expectedRevision` **不进模型入参**——它是会话指纹，由本层现读现填（09-10 实测：模型每猜错一次
 *      就烧掉一次完整往返，22 次失败里 9 次是这一类）；
 *   ③ 把结果整理成 §4.3 的信封，其中 `unverified` 永远留着 `model_produces_output`。
 *
 * ── 地址与鉴权放法一个字都不在入参里 ──────────────────────────────────────────────────
 * `suggestedBaseUrl` 只用于**新建**连接时预填那一页，用户按下保存才把 key 绑到那个 origin
 * （§6.1，`catalog/credentialBinding.ts`）。对**已存在**的连接，这一层拒绝任何地址建议——
 * 改地址只有一条路：回那一页重新保存一次密钥。
 */
import {
  deleteModelCatalogModels,
  deleteModelCatalogVendor,
  listModelCatalogVendors,
  readCatalog,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
  mutateCatalog,
} from "../../catalog/catalogStore";
import { readCredentialBinding } from "../../catalog/credentialBinding";
import { isJsonRecord } from "../../jsonUtils";
import type { CapabilityOriginHost } from "../security";
import { getIntegrationSessionService, type IntegrationSessionService } from "../../integrationCertification/integrationSession";
import { withCredentialElicitationTicket } from "../../integrationCertification/credentialElicitation";
import { catalogFingerprint, changeIdFor } from "./fingerprint";
import { submitDeclaration } from "./submitDeclaration";
import { tryModel, type TryModelDeps } from "./tryModel";
import {
  noBlast,
  unverified,
  type OnboardingFailure,
  type OnboardingResult,
} from "./envelope";

export type OnboardingDispatchDeps = {
  /**
   * 会话服务**按需现取**：只有「打开贴 key 页」与「取消」两跳真的用它。
   *
   * 以前这里是一个现成的值，而装配处一律 `ctx.sessions || getIntegrationSessionService()`——
   * 于是在没装会话服务的宿主上，连「交一份卡」「填一把 key」这种根本不碰会话的动作也会
   * 在装配那一行当场抛 `integration_session_service_not_installed`。那正是本刀要拆的那种
   * 耦合的最后一处残留：一个跟你无关的东西没准备好，你就不许动。
   */
  sessions: () => IntegrationSessionService;
  owner: CapabilityOriginHost;
  /** 打开 Nomi 的贴 key 页（app 没开时排队等下次打开，与旧 open_credentials 同一条路）。 */
  openCredentialsInNomi?: (input: { sessionId: string; vendorName: string }) => Promise<{ opened: boolean } | void> | { opened: boolean } | void;
  /** 铸一次性 MCP URL elicitation 票（与旧 open_credentials 同一处）。 */
  withCredentialElicitationTicket: (projection: Record<string, unknown>) => Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** 目录里现在有哪几行——`ifUnchanged` 与 `nomi_read target=models` 读的是同一份。 */
export function currentCatalogFingerprint(): string {
  const catalog = readCatalog();
  return catalogFingerprint(catalog.models.map((model) => ({ vendor: model.vendorKey, modelKey: model.modelKey })));
}

// ── connect_provider ────────────────────────────────────────────────────────────────

async function connectProvider(
  deps: OnboardingDispatchDeps,
  args: Record<string, unknown>,
): Promise<OnboardingResult | OnboardingFailure> {
  const vendorKey = text(args.vendorKey);
  const suggestedBaseUrl = text(args.suggestedBaseUrl);
  // 查一次，两处用（改名/代理开关那一段，和下面重开贴 key 页那一跳）。
  const vendor = vendorKey ? listModelCatalogVendors().find((row) => row.key === vendorKey) : undefined;

  if (vendorKey) {
    if (!vendor) {
      return {
        ok: false, code: "not_found",
        message: `No connection called ${vendorKey}. Read nomi_read target=models for the ids that exist.`,
        nextAction: "Call nomi_read target=models and use one of the vendor ids it returns.",
      };
    }
    // 地址与鉴权放法只在**已经有绑定**时是只读的：那时改它们等于让一段对话文本决定一把
    // 已存密钥发往哪里。没有绑定（新家、或这条连接从来没存过 key）时没有任何密钥会因此改道，
    // 拒绝它只是把一条正路堵死。
    //
    // 2026-09-21 K1 就是这条判据被写反的样子：分支只判「有没有传地址」，于是一条
    // **根本没有 key** 的连接被告知 "already holds a key"——第 1 次调用就撞上，而且是句假话。
    const binding = readCredentialBinding(vendor);
    if (suggestedBaseUrl && binding?.origin) {
      return {
        ok: false, code: "credential_origin_mismatch",
        message: `This connection's saved key is bound to ${binding.origin}. Where a saved key is sent is decided by the user on Nomi's credential page, not by an argument.`,
        nextAction: "Call connect_provider again with reissueKey=true (and no suggestedBaseUrl): Nomi reopens that page with the address editable, and the user's save rebinds the key.",
      };
    }
    const changes: OnboardingResult["changes"] = [];
    const name = text(args.name);
    if (name && name !== vendor.name) {
      upsertModelCatalogVendor({ key: vendorKey, name });
      changes.push({ state: "S11.1", summary: `Renamed the connection to ${name}.` });
    }
    if (typeof args.proxyEnabled === "boolean") {
      if (args.proxyEnabled && !vendor.network?.proxyUrl) {
        return {
          ok: false, code: "needs_input",
          message: "This connection has no proxy saved, so there is nothing to switch on.",
          needs: ["a proxy URL saved by the user in Nomi's network settings"],
          nextAction: "Ask the user to save a proxy for this connection in Nomi's model settings first.",
        };
      }
      upsertModelCatalogVendor({ key: vendorKey, network: { proxyEnabled: args.proxyEnabled } });
      changes.push({ state: "S11.1", summary: `Turned this connection's proxy ${args.proxyEnabled ? "on" : "off"}.` });
    }
    if (args.reissueKey !== true) {
      return {
        ok: true, vendorKey, state: { vendorKey, name: name || vendor.name },
        unverified: unverified("model_produces_output"),
        changes, blastRadius: noBlast(),
        nextAction: { kind: "none", userSees: "The connection is updated. Nothing was sent anywhere." },
      };
    }
  }

  if (!vendorKey && !text(args.name)) {
    return {
      ok: false, code: "needs_input",
      message: "connect_provider needs a name for a new connection, or a vendorKey to adjust one that exists.",
      needs: ["name"],
      nextAction: "Send name (the provider's display name), plus docs and suggestedBaseUrl when you have them.",
    };
  }
  if (!vendorKey && !suggestedBaseUrl) {
    return {
      ok: false, code: "needs_input",
      message: "Nomi needs an address to pre-fill on the credential page before the user can confirm it.",
      needs: ["suggestedBaseUrl"],
      nextAction: "Read the provider's documentation for its API base URL and send it as suggestedBaseUrl. The user confirms it by saving; you never decide it.",
    };
  }

  const opened = vendorKey
    ? reopenForVendor(deps, vendorKey, vendor)
    : deps.sessions().begin({
      kind: "http-api-provider",
      name: text(args.name),
      baseUrl: suggestedBaseUrl,
      ...(text(args.docs) ? { docs: text(args.docs) } : {}),
    }, deps.owner);
  if ("ok" in opened) return opened;

  const credentials = deps.sessions().openCredentials(opened.id, opened.revision, deps.owner);
  let ui: { opened: boolean } | void;
  try {
    ui = await deps.openCredentialsInNomi?.({ sessionId: credentials.id, vendorName: credentials.config.name });
  } catch {
    // 排队的交接单会在 Nomi 下次打开时重放；窗口消失不该让 MCP 契约不可用。
    ui = { opened: false };
  }
  // 收据由**页面到底开没开**决定，不由这一跳的意图决定。2026-09-21 K3：同一个信封里
  // `changes` 写着 "Opened Nomi's credential page"，而 `credentialEntry.instructions` 写着
  // 「Nomi 没在运行」——AI 会照着前半句对用户说「我已经帮你打开了，去看一眼」，而用户面前
  // 什么都没有。一封信里两句互相打脸，等于教模型撒谎。
  const opened_ui = ui?.opened === true;
  const ticketed = deps.withCredentialElicitationTicket({ ...credentials, credentialUiOpened: opened_ui });
  const credentialUrl = typeof (ticketed as { credentialUrl?: unknown }).credentialUrl === "string"
    ? (ticketed as { credentialUrl: string }).credentialUrl
    : undefined;
  return {
    ok: true,
    setupId: credentials.id,
    changeId: changeIdFor(credentials.id, "connect_provider", args),
    state: ticketed,
    unverified: unverified("endpoint_reachable", "credential_accepted", "declaration_valid", "model_produces_output"),
    changes: [{
      state: "S11.1",
      summary: opened_ui
        ? `Opened Nomi's credential page for ${credentials.config.name}.`
        : credentialUrl
          ? `Queued the credential page for ${credentials.config.name}; the user opens it from the link in nextAction.`
          : `Queued the credential page for ${credentials.config.name}. Nomi is not running, so nothing is on screen yet; it opens the next time the user starts Nomi.`,
    }],
    blastRadius: noBlast(),
    nextAction: {
      kind: opened_ui || credentialUrl ? "user_sees_key_page" : "waiting_for_user",
      userSees: opened_ui
        ? `Nomi is showing the address this key will be bound to${suggestedBaseUrl ? ` (${suggestedBaseUrl})` : ""} with a box to paste the key. Saving is the user's confirmation of that address.`
        : credentialUrl
          ? "Nomi is not on screen. Give the user the one-time link in this reply; the page it opens is Nomi's own, and the key never passes through you."
          : "Nomi is not running, so nothing is on screen. Tell the user to start Nomi: the credential page opens for them then. Do not say a page is already open.",
      waitWith: "nomi_read target=setup waitMs",
      ...(credentialUrl ? { url: credentialUrl } : {}),
    },
  };
}

/**
 * 已存在的连接要重新贴 key：地址**沿用它自己那一行**，不由这一跳的入参决定。
 *
 * 这条路刻意与「新建一家」分开命名（而不是合成一次 `begin`）：两者的地址来源不同——
 * 一个来自已存的 vendor 行，一个来自 Agent 的建议且必须由用户在那一页上确认。把它们写成
 * 同一个表达式，正好抹掉本刀要守的那条区别（§6.1）。vendor 由调用方传进来，不重查一次。
 */
function reopenForVendor(
  deps: OnboardingDispatchDeps,
  vendorKey: string,
  vendor: { name?: string; baseUrlHint?: string | null } | undefined,
): OnboardingFailure | ReturnType<IntegrationSessionService["begin"]> {
  const baseUrl = text(vendor?.baseUrlHint);
  if (!baseUrl) {
    return {
      ok: false, code: "needs_input",
      message: `Connection ${vendorKey} has no address on file, so Nomi cannot reopen its credential page.`,
      needs: ["the user to add this connection in Nomi's model settings"],
      nextAction: "Ask the user to open Nomi's model settings and add the address there.",
    };
  }
  return deps.sessions().begin({
    kind: "http-api-provider",
    name: vendor?.name || vendorKey,
    baseUrl,
  }, deps.owner);
}

// ── set_key ─────────────────────────────────────────────────────────────────────────

/**
 * 密钥的第二个入口（§4，用户 09-21 拍板）。**同一份存储、同一扇写门、同一套 origin 绑定。**
 *
 * 为什么这不算「两套实现」：这一跳做的事和用户在贴 key 页按下保存**逐字相同**——
 * 都调 `applyApiKeyUpsert`，绑定在那扇门里自动生成（`bindCredentialDestination`），
 * 出站守卫照判。变的只有「谁敲的这串字」，而那从来不是安全不变量。
 * 真正的两条不变量一条没松：① 已存 key 要发往新域名仍须用户在 Nomi 里确认（去向不在入参里，
 * 由 vendor 行 + 用户确认决定）；② Nomi 永不把已存 key 回显出去（这一跳也不回显它刚收的那把）。
 */
function setKey(args: Record<string, unknown>): OnboardingResult | OnboardingFailure {
  const vendorKey = text(args.vendorKey);
  const apiKey = typeof args.apiKey === "string" ? args.apiKey.trim() : "";
  const vendor = vendorKey ? listModelCatalogVendors().find((row) => row.key === vendorKey) : undefined;
  if (!vendor) {
    return {
      ok: false, code: "not_found",
      message: `No connection called ${vendorKey || "(missing vendorKey)"}. A key can only be saved onto a connection that exists.`,
      nextAction: "Submit the declaration first (action=submit_declaration): it creates the connection. Then save the key onto it.",
    };
  }
  if (!apiKey) {
    return {
      ok: false, code: "needs_input",
      message: "set_key needs the key itself.",
      needs: ["apiKey"],
      nextAction: "Send apiKey exactly as the provider issued it — and only when the user handed it to you for this. Otherwise use connect_provider so the user pastes it on Nomi's own page.",
    };
  }
  try {
    upsertModelCatalogVendorApiKey(vendorKey, { apiKey });
  } catch (error) {
    // 写门自己的判据（非法字符等）原样透传：它说的是这把 key 本身的问题，我们没有更好的话。
    return {
      ok: false, code: "invalid_args",
      message: error instanceof Error ? error.message.slice(0, 400) : "The key was rejected by Nomi's credential store.",
      nextAction: "Ask the user to check what they pasted, then send it again. Nothing was saved.",
    };
  }
  // 界面上那一行「这把 key 是你的 AI 填的」。只记**来源与时间**，不记 key 的任何一段。
  upsertModelCatalogVendor({
    key: vendorKey,
    meta: { ...(isJsonRecord(vendor.meta) ? vendor.meta : {}), credentialSource: { kind: "agent", at: new Date().toISOString() } },
  });
  const binding = readCredentialBinding(listModelCatalogVendors().find((row) => row.key === vendorKey));
  return {
    ok: true, vendorKey,
    // 回的是「有没有」，不是 key 的任何一段——两条不变量里的第二条就住在这一行的克制里。
    state: { vendorKey, hasApiKey: true, boundOrigin: binding?.origin ?? null },
    unverified: unverified("credential_accepted", "model_produces_output"),
    changes: [{ state: "S11.1", summary: `Saved a key for ${vendor.name}${binding?.origin ? `, bound to ${binding.origin}` : ""}.` }],
    blastRadius: noBlast(),
    nextAction: {
      kind: "none",
      userSees: `Nomi shows on ${vendor.name}'s card that this key was entered by the user's AI, and where it is bound. Prove the model works with nomi_try_model before saying it is connected.`,
    },
  };
}

// ── show_models / cancel ────────────────────────────────────────────────────────────

function showModels(args: Record<string, unknown>): OnboardingResult | OnboardingFailure {
  const vendorKey = text(args.vendorKey);
  const modelKeys = Array.isArray(args.modelKeys) ? args.modelKeys.map((key) => text(key)).filter(Boolean) : [];
  const visible = args.visible === true;
  const catalog = readCatalog();
  const missing = modelKeys.filter((modelKey) => !catalog.models.some((model) => model.vendorKey === vendorKey && model.modelKey === modelKey));
  if (missing.length > 0) {
    return {
      ok: false, code: "not_found",
      message: `These models are not on connection ${vendorKey}: ${missing.join(", ")}.`,
      nextAction: "Call nomi_read target=models and use the exact vendor and model ids it returns.",
    };
  }
  for (const modelKey of modelKeys) upsertModelCatalogModel({ vendorKey, modelKey, enabled: visible });
  return {
    ok: true, vendorKey,
    state: { vendorKey, modelKeys, visible },
    unverified: unverified("model_produces_output"),
    changes: [{ state: "S11.6", summary: `${visible ? "Showed" : "Hid"} ${modelKeys.length} model(s).` }],
    blastRadius: {
      ...noBlast(),
      modelsAppearing: visible ? modelKeys.length : 0,
      modelsDisappearing: visible ? 0 : modelKeys.length,
    },
    nextAction: {
      kind: "none",
      userSees: visible
        ? `${modelKeys.length} model(s) are back in the pickers.`
        : `${modelKeys.length} model(s) are hidden from the pickers. Nothing was deleted; they can be shown again.`,
    },
  };
}

function cancelSetup(deps: OnboardingDispatchDeps, args: Record<string, unknown>): OnboardingResult | OnboardingFailure {
  const setupId = text(args.setupId);
  const sessions = deps.sessions();
  const before = sessions.get(setupId, deps.owner) as { revision: number };
  const cancelled = sessions.cancel(setupId, before.revision, deps.owner);
  return {
    ok: true, setupId, state: cancelled,
    unverified: unverified("model_produces_output"),
    changes: [{ state: "S11.0", summary: "Abandoned this setup." }],
    blastRadius: noBlast(),
    nextAction: { kind: "none", userSees: "The setup is abandoned. An already-saved key and an already-connected provider are untouched." },
  };
}

// ── remove ──────────────────────────────────────────────────────────────────────────

export function removeProvider(args: Record<string, unknown>): OnboardingResult | OnboardingFailure {
  const vendorKey = text(args.vendorKey);
  const modelKeys = Array.isArray(args.modelKeys) ? args.modelKeys.map((key) => text(key)).filter(Boolean) : [];
  const expected = text(args.ifUnchanged);
  const actual = currentCatalogFingerprint();
  if (expected !== actual) {
    return {
      ok: false, code: "stale_fingerprint",
      message: `The model list changed since you read it (you had ${expected}, it is now ${actual}). Nothing was deleted.`,
      nextAction: "Call nomi_read target=models again, check the rows are still the ones you meant, and retry with the fingerprint it returns.",
    };
  }
  const catalog = readCatalog();
  if (!catalog.vendors.some((vendor) => vendor.key === vendorKey)) {
    return {
      ok: false, code: "not_found",
      message: `No connection called ${vendorKey}.`,
      nextAction: "Call nomi_read target=models for the ids that exist.",
    };
  }
  if (modelKeys.length > 0) {
    deleteModelCatalogModels(modelKeys.map((modelKey) => ({ vendorKey, modelKey })));
    return {
      ok: true, vendorKey, state: { vendorKey, deletedModelKeys: modelKeys },
      unverified: [],
      changes: [{ state: "S11.6", summary: `Deleted ${modelKeys.length} model(s) from ${vendorKey}.` }],
      blastRadius: { ...noBlast(), modelsDisappearing: modelKeys.length, recordsDeleted: modelKeys.length },
      nextAction: { kind: "user_sees_confirm_card", userSees: `${modelKeys.length} model(s) are gone for good. The connection and its key are untouched.` },
    };
  }
  // 整家删：**用户显式删的家不许下次启动再种回来**（Q12）。升级/重装不走这条路，所以它只对
  // 「他自己按的那一下」生效。
  const builtinModels = catalog.models.filter((model) =>
    model.vendorKey === vendorKey && isJsonRecord(model.meta) && typeof model.meta.catalogLifecycle === "string");
  const deletedCount = catalog.models.filter((model) => model.vendorKey === vendorKey).length;
  if (builtinModels.length > 0) {
    mutateCatalog((_tx, state) => {
      const mutable = state as unknown as { suppressedBuiltinModels?: Array<{ vendorKey: string; modelKey: string }> };
      const suppressed = [...(mutable.suppressedBuiltinModels || [])];
      for (const model of builtinModels) {
        if (!suppressed.some((row) => row.vendorKey === vendorKey && row.modelKey === model.modelKey)) {
          suppressed.push({ vendorKey, modelKey: model.modelKey });
        }
      }
      mutable.suppressedBuiltinModels = suppressed;
    });
  }
  deleteModelCatalogVendor(vendorKey);
  return {
    ok: true, vendorKey, state: { vendorKey, deleted: true },
    unverified: [],
    changes: [{ state: "S11.6", summary: `Deleted the ${vendorKey} connection, its saved key and ${deletedCount} model(s).` }],
    blastRadius: { ...noBlast(), modelsDisappearing: deletedCount, recordsDeleted: deletedCount + 1 },
    nextAction: {
      kind: "user_sees_confirm_card",
      userSees: `${vendorKey} is gone for good, including the saved key. Nomi will not seed it back on the next start.`,
    },
  };
}

// ── 入口 ────────────────────────────────────────────────────────────────────────────

export async function dispatchModelSetup(
  deps: OnboardingDispatchDeps,
  params: Record<string, unknown>,
): Promise<OnboardingResult | OnboardingFailure> {
  switch (text(params.action)) {
    case "connect_provider": return connectProvider(deps, params);
    case "submit_declaration": return submitDeclaration(params);
    case "set_key": return setKey(params);
    case "show_models": return showModels(params);
    case "cancel": return cancelSetup(deps, params);
    default:
      return {
        ok: false, code: "invalid_args",
        message: `nomi_model_setup needs one of these actions: connect_provider, submit_declaration, set_key, show_models, cancel.`,
        nextAction: "Send action with one of those five values.",
      };
  }
}

/**
 * dispatcher 的那两格（`model.onboarding.*`）。**依赖装配也住这里**，不住 `dispatcher.ts`：
 * 那份是已知巨壳（R9，上限 800 行），而这两格要的东西（会话服务、贴 key 页、一次性票）
 * 与它的其它 case 一个都不共享——装配写在那边只是让巨壳再长六行。
 */
export function dispatchModelOnboarding(
  method: string,
  params: Record<string, unknown>,
  ctx: {
    owner: CapabilityOriginHost;
    sessions?: IntegrationSessionService;
    openCredentialsInNomi?: OnboardingDispatchDeps["openCredentialsInNomi"];
    runTask?: TryModelDeps["runTask"];
    fetchTaskResult?: TryModelDeps["fetchTaskResult"];
    approvalPolicy?: TryModelDeps["approvalPolicy"];
  },
): Promise<OnboardingResult | OnboardingFailure> | OnboardingResult | OnboardingFailure {
  if (method === "model.onboarding.remove") return removeProvider(params);
  if (method === "model.onboarding.try") {
    if (!ctx.runTask) throw new Error("model.onboarding.try needs the task runner; it runs on the same executor as the canvas.");
    return tryModel({
      runTask: ctx.runTask,
      ...(ctx.fetchTaskResult ? { fetchTaskResult: ctx.fetchTaskResult } : {}),
      // 档位从宿主一路传下来。**不传 = 不猜 = 照旧问人**，与 Run 侧那条同一条纪律。
      ...(ctx.approvalPolicy ? { approvalPolicy: ctx.approvalPolicy } : {}),
    }, params);
  }
  return dispatchModelSetup({
    sessions: () => ctx.sessions || getIntegrationSessionService(),
    owner: ctx.owner,
    ...(ctx.openCredentialsInNomi ? { openCredentialsInNomi: ctx.openCredentialsInNomi } : {}),
    withCredentialElicitationTicket: (projection) => withCredentialElicitationTicket(projection as never) as Record<string, unknown>,
  }, params);
}
