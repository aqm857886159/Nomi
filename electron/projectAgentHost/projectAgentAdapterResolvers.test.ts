import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionPartition,
  ProjectAgentProposalReceiptWriter,
  SubscriptionRecord,
} from "./projectAgentExecutionCoordinatorTypes";
import { createProjectAgentAdapterResolvers } from "./projectAgentAdapterResolvers";

const binding = {
  projectId: "project-resolver",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;

function writer(): ProjectAgentProposalReceiptWriter {
  return {
    read: vi.fn(() => null),
    write: vi.fn(),
    transition: vi.fn(),
  } as unknown as ProjectAgentProposalReceiptWriter;
}

function subscription(subscriptionId: string, subscriptionEpoch: number): SubscriptionRecord {
  return {
    subscriptionId,
    subscriptionEpoch,
    binding,
    partitionKey: "project-resolver",
    snapshot: {} as SubscriptionRecord["snapshot"],
  };
}

describe("Project Agent receipt writer resolver", () => {
  it("uses the preferred writer and falls back to the newest live writer", () => {
    const oldWriter = writer();
    const newestWriter = writer();
    const subscriptions = new Map([
      ["old", subscription("old", 1)],
      ["newest", subscription("newest", 2)],
    ]);
    const writers = new Map([
      ["old", oldWriter],
      ["newest", newestWriter],
    ]);
    const partition = {
      subscriptionIds: new Set(["old", "newest"]),
    } as ExecutionPartition;
    const resolvers = createProjectAgentAdapterResolvers({
      subscriptions,
      canvasReads: new Map(),
      documentReads: new Map(),
      documentWrites: new Map(),
      canvasWrites: new Map(),
      timelineReads: new Map(),
      timelineWrites: new Map(),
      phase4Surfaces: new Map(),
      skillReads: new Map(),
      skillWrites: new Map(),
      proposalReceiptReaders: new Map(),
      proposalReceiptWriters: writers,
    });

    expect(resolvers.proposalReceiptWriterFor(partition, "old")).toBe(oldWriter);
    expect(resolvers.proposalReceiptWriterFor(partition, "released-subscription")).toBe(newestWriter);
  });
});
