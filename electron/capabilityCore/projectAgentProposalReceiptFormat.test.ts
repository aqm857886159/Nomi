import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProjectAgentProposalReceiptService,
  projectAgentProposalReceiptPath,
} from "./projectAgentProposalReceiptStore";

/**
 * 落盘格式钉子（前置 PR ②「G5 收据搬家」的搬家不变量）。
 *
 * 这条测试的唯一职责：把 `<project>/.nomi/project-agent-proposal-receipt.json` 的
 * **字节**冻结成下面这个字面量。收据 owner 从 `projectAgentHost/` 搬到 `capabilityCore/`
 * 时，同一份输入必须产出逐字节相同的文件——路径、`schemaVersion:2`、键顺序、缩进、
 * 结尾换行、`proposalHash` / `journalHash` 的域串与摘要算法，一个都不许漂。
 *
 * 用户那一刻的摩擦：这份文件是「撤销这次改动」和崩溃后「批过的动作到底写没写」的
 * 唯一证据，而且 MCP 外部宿主也在写它。搬家漂一个字节 = 老项目的收据读不回来。
 *
 * 时间与 UUID 是这份文件里仅有的两个非确定输入：`updatedAt` 由假时钟钉死；
 * `writeJsonFileAtomic` 的随机 temp 文件名不进最终字节。
 */
const FROZEN_NOW = "2026-01-01T00:00:00.000Z";

const binding = {
  projectId: "receipt-format-project",
  immutableProjectUuid: "33333333-3333-4333-8333-333333333333",
  projectGeneration: 1,
} as const;

const proposal = {
  proposalId: "proposal-format-a",
  summary: "created one shot",
  stepLabels: ["created Shot A"],
  categoryCounts: [{ categoryId: "shots", label: "Shots", count: 1 }],
  compensation: [
    { kind: "disconnect-edges", pairs: [{ source: "node-a", target: "node-b" }] },
    { kind: "delete-nodes", nodeIds: ["node-a"] },
  ],
  watchNodes: [{ nodeId: "node-a", title: "Shot A", prompt: "wide shot" }],
  reconciliationOk: false,
  anchorMessageId: "assistant-a",
  anchorTextOffset: 12,
} as const;

const GOLDEN_BYTES = `{
  "schemaVersion": 2,
  "binding": {
    "projectId": "receipt-format-project",
    "immutableProjectUuid": "33333333-3333-4333-8333-333333333333",
    "projectGeneration": 1
  },
  "revision": 2,
  "lifecycle": "committed",
  "proposalId": "proposal-format-a",
  "operationId": "commit-proposal-format-a",
  "proposal": {
    "proposalId": "proposal-format-a",
    "summary": "created one shot",
    "stepLabels": [
      "created Shot A"
    ],
    "categoryCounts": [
      {
        "categoryId": "shots",
        "label": "Shots",
        "count": 1
      }
    ],
    "compensation": [
      {
        "kind": "disconnect-edges",
        "pairs": [
          {
            "source": "node-a",
            "target": "node-b"
          }
        ]
      },
      {
        "kind": "delete-nodes",
        "nodeIds": [
          "node-a"
        ]
      }
    ],
    "watchNodes": [
      {
        "nodeId": "node-a",
        "title": "Shot A",
        "prompt": "wide shot"
      }
    ],
    "reconciliationOk": false,
    "anchorMessageId": "assistant-a",
    "anchorTextOffset": 12
  },
  "proposalHash": "5a380147a825238c08680ad2d677e4767ddb5274e7a380bd35e4cf138392b6dc",
  "operations": [
    {
      "operationId": "prepare-proposal-format-a",
      "requestHash": "e21186f62828a0a5568a22d8c52455026bed347f05dcc2ff84696fddd44c7cd3",
      "appliedRevision": 1
    },
    {
      "operationId": "commit-proposal-format-a",
      "requestHash": "86d19963e7641f8743577b765f9b365adda2256b06b0ea0ff0d9c8fb68201f60",
      "appliedRevision": 2
    }
  ],
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "journalHash": "d262c60bfedeb9b4b3bc35df17c8305c6122c3082ce2148f6499e6e00881c957"
}
`;

let root = "";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-receipt-format-"));
  fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("ProjectAgent proposal receipt on-disk format", () => {
  it("writes the frozen path and byte-for-byte identical contents for a fixed input", () => {
    const service = createProjectAgentProposalReceiptService({ projectRoot: root, binding });
    const prepared = service.write({
      expectedRevision: 0,
      proposalId: proposal.proposalId,
      operationId: "prepare-proposal-format-a",
      lifecycle: "preparing",
      proposal,
    });
    service.write({
      expectedRevision: prepared.revision,
      proposalId: proposal.proposalId,
      operationId: "commit-proposal-format-a",
      lifecycle: "committed",
      proposal,
    });

    const target = projectAgentProposalReceiptPath(root);
    expect(path.relative(root, target).split(path.sep)).toEqual([".nomi", "project-agent-proposal-receipt.json"]);
    expect(fs.readFileSync(target, "utf8")).toBe(GOLDEN_BYTES);
  });
});
