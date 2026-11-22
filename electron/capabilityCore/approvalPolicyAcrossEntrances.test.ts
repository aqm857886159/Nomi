/**
 * 三档 × 三入口：**用户选的审批档位，在每一个能花钱的入口上都得真生效**。
 *
 * ── 用户镜头 ──────────────────────────────────────────────────────────────────
 * 用户在设置里把档位切到「全自动」（切进去还要二次确认、面板顶上常驻提醒），然后：
 *   · Agent 面板发起生成 → 不再逐笔弹报价卡，直接跑 ✅（2026-09-12 起就是对的）
 *   · **外部 MCP 发起生成** → 仍然要他回 Nomi 窗口点一次
 *   · **外部 MCP 的接入试跑**（`nomi_try_model`）→ 也要他回去点一次
 * 后两条是同一个成因：那两个宿主**根本没把档位递进调度上下文**（`ctx.approvalPolicy`），
 * 于是下游每一个读档位的判据都读到 `undefined`，一律按「不知道档位 = 不许替用户花钱」走。
 * 那条 fail-closed 本身是对的，错的是它被当成了常态。
 *
 * ── 为什么这条测试同时有行为断言与结构断言 ────────────────────────────────────
 * 行为那半（gate 分支）证明「读得到档位时决策是对的」；结构那半证明「宿主真的把档位递了下去」。
 * 只有前者会漏掉真正的 bug——判据写得再对，没人把档位交给它，它照样答不出来。
 */
import { issueGenerationPlanningForTest } from "./generationPlanningIssue";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bindApprovalReceiptIssuer } from "./runOwnedGenerationGateAuthority";
import { dispatchSemanticGeneration } from "./generationDispatcher";
import type { DispatchContext } from "./dispatcher";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";

const CONTRACT_HASH = "c".repeat(64);
const LEASE = Object.freeze({
  projectId: "project-1",
  immutableProjectUuid: "project-uuid-1",
  projectGeneration: 1,
  revocationEpoch: 1,
  token: "lease-token",
});

type Minted = { receipt: { receiptId: string; decidedBy: string }; token: string };

function receiptAuthority(): { authority: NonNullable<DispatchContext["approvalReceiptAuthority"]>; minted: Minted[] } {
  const minted: Minted[] = [];
  const authority = {
    requestChallenge: () => ({
      challenge: {
        challengeId: "challenge-1",
        nonce: "nonce-1",
        expiresAt: "2026-09-21T01:00:00.000Z",
        costScope: "generation.single-shot",
        reservationPreview: { currency: "CNY", maximum: 3 },
      },
      token: "challenge-token",
    }),
    createPolicyDecisionAttestation: (_token: string, input: { policyMode: string; policySurface: string }) =>
      ({ kind: "policy_decision", ...input }),
    mintReceipt: (_token: string, attestation: { policySurface?: string }) => {
      const value: Minted = {
        receipt: { receiptId: `receipt-${minted.length + 1}`, decidedBy: "policy:full_auto" },
        token: `receipt-token-${minted.length + 1}`,
      };
      minted.push(value);
      void attestation;
      return value;
    },
    resolveReceiptToken: () => undefined,
    consumeReceipt: () => undefined,
  } as unknown as NonNullable<DispatchContext["approvalReceiptAuthority"]>;
  bindApprovalReceiptIssuer(authority, authority as unknown as Parameters<typeof bindApprovalReceiptIssuer>[1]);
  return { authority, minted };
}

function contextFor(policy: ProjectAgentApprovalPolicy | undefined, withPolicy: boolean) {
  const receipts = receiptAuthority();
  const ctx = {
    projectSession: {
      authority: { verifyLease: async () => LEASE },
      connection: {},
    },
    generationPlanning: issueGenerationPlanningForTest(async () => ({
      operationId: "op-1",
      contractHash: CONTRACT_HASH,
      maximumCost: 3,
      currency: "CNY",
      model: "fixture-model",
    })),
    approvalReceiptAuthority: receipts.authority,
    projectRevisionResolver: () => 1,
    ...(withPolicy ? { approvalPolicy: () => policy } : {}),
  } as unknown as DispatchContext;
  return { ctx, receipts };
}

async function requestGate(policy: ProjectAgentApprovalPolicy | undefined, withPolicy = true) {
  const { ctx, receipts } = contextFor(policy, withPolicy);
  const result = await dispatchSemanticGeneration(
    "nomi_request_generation_gate",
    { leaseHandle: "lease-token", projectId: "project-1", operationId: "op-1" },
    ctx,
  ) as { handoff?: { receiptId?: string; receiptToken?: string; decidedBy?: string } };
  return { result, minted: receipts.minted };
}

describe("三档 × 外部 MCP 的付费门", () => {
  it("全自动：宿主当场按策略决门，模型拿到收据可以直接往下跑（不用把人叫回 Nomi 窗口）", async () => {
    const { result, minted } = await requestGate({ mode: "direct" });
    expect(minted, "策略决门必须真的铸一张收据——闸一步都不能少").toHaveLength(1);
    expect(result.handoff?.decidedBy).toBe("policy:full_auto");
    expect(result.handoff?.receiptId).toBe("receipt-1");
    expect(result.handoff?.receiptToken).toBe("receipt-token-1");
  });

  for (const mode of ["request", "request"] as const) {
    it(`${mode}：一个字没变——仍然交回挑战让用户在 Nomi 窗口里点，收据一张都不铸`, async () => {
      const { result, minted } = await requestGate({ mode });
      expect(minted).toHaveLength(0);
      expect(result.handoff?.receiptId).toBeUndefined();
      expect(result.handoff?.decidedBy).toBeUndefined();
    });
  }

  it("宿主没递档位：按默认走，绝不替用户花钱", async () => {
    const { result, minted } = await requestGate(undefined, false);
    expect(minted).toHaveLength(0);
    expect(result.handoff?.receiptId).toBeUndefined();
  });
});

/**
 * 结构那半：两个 MCP 宿主必须把**持久化的那一份**档位递进调度上下文。
 *
 * 判据写成「这个文件里提到 approvalPolicy 且提到 readAgentApprovalPolicy」——它抓的正是
 * 2026-09-21 之前的真实状态：两个宿主一个字都没提过 `approvalPolicy`，于是 `try_model`
 * 与付费门在外部 MCP 上永远读不到用户选的档。
 */
describe("每个宿主都把用户选的那一档递了下去", () => {
  for (const host of ["mcpStdioServer.ts", "appIntegration.ts"] as const) {
    it(`${host}：档位来自持久化的那一份（readAgentApprovalPolicy），不是自己编一个`, () => {
      const source = fs.readFileSync(path.join(process.cwd(), "electron/capabilityCore", host), "utf8");
      expect(source.includes("approvalPolicy"), `${host} 没有把档位递进调度上下文`).toBe(true);
      expect(source.includes("readAgentApprovalPolicy"), `${host} 的档位不是从持久化那份读的`).toBe(true);
    });
  }
});
