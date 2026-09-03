import type {
  PiCanvasReadTransportAdapter,
} from "../capabilityCore/canvasReadTransportAdapters";
import type { PiDocumentReadTransportAdapter } from "../capabilityCore/documentReadTransportAdapters";
import type { PiDocumentWriteTransportAdapter } from "../capabilityCore/documentWriteTransportAdapters";
import type { PiCanvasWriteTransportAdapter } from "../capabilityCore/canvasWriteTransportAdapters";
import type { PiTimelineReadTransportAdapter, PiTimelineWriteTransportAdapter } from "../capabilityCore/timelineTransportAdapters";
import type { PiPhase4SurfaceTransportAdapter } from "../capabilityCore/phase4SurfaceTransportAdapters";
import type { PiSkillWriteTransportAdapter } from "../capabilityCore/skillWriteTransportAdapters";
import type { PiSkillReadTransportAdapter } from "../capabilityCore/skillReadTransportAdapters";
import {
  type ExecutionPartition,
  type ProjectAgentProposalReceiptReader,
  type SubscriptionRecord,
} from "./projectAgentExecutionCoordinatorTypes";

type AdapterMap<A> = Map<string, A | undefined>;

type ProjectAgentAdapterResolverDeps = Readonly<{
  subscriptions: Map<string, SubscriptionRecord>;
  canvasReads: AdapterMap<PiCanvasReadTransportAdapter>;
  documentReads: AdapterMap<PiDocumentReadTransportAdapter>;
  documentWrites: AdapterMap<PiDocumentWriteTransportAdapter>;
  canvasWrites: AdapterMap<PiCanvasWriteTransportAdapter>;
  timelineReads: AdapterMap<PiTimelineReadTransportAdapter>;
  timelineWrites: AdapterMap<PiTimelineWriteTransportAdapter>;
  phase4Surfaces: AdapterMap<PiPhase4SurfaceTransportAdapter>;
  skillReads: AdapterMap<PiSkillReadTransportAdapter>;
  skillWrites: AdapterMap<PiSkillWriteTransportAdapter>;
  proposalReceiptReaders: AdapterMap<ProjectAgentProposalReceiptReader>;
}>;

export type ProjectAgentAdapterResolvers = Readonly<{
  canvasReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string, turnCanvasRead?: PiCanvasReadTransportAdapter) => PiCanvasReadTransportAdapter | undefined;
  documentReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiDocumentReadTransportAdapter | undefined;
  documentWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiDocumentWriteTransportAdapter | undefined;
  canvasWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiCanvasWriteTransportAdapter | undefined;
  timelineReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiTimelineReadTransportAdapter | undefined;
  timelineWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiTimelineWriteTransportAdapter | undefined;
  phase4SurfaceFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiPhase4SurfaceTransportAdapter | undefined;
  skillReadFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiSkillReadTransportAdapter | undefined;
  skillWriteFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => PiSkillWriteTransportAdapter | undefined;
  proposalReceiptReaderFor: (partition: ExecutionPartition, preferredSubscriptionId: string) => ProjectAgentProposalReceiptReader | undefined;
}>;

function mostRecentAdapterFor<A>(
  subscriptions: Map<string, SubscriptionRecord>,
  partition: ExecutionPartition,
  preferredSubscriptionId: string,
  adapters: AdapterMap<A>,
): A | undefined {
  const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
    ? adapters.get(preferredSubscriptionId)
    : undefined;
  if (currentPreferred) return currentPreferred;
  let selected: A | undefined;
  let selectedEpoch = -1;
  for (const subscriptionId of partition.subscriptionIds) {
    const subscription = subscriptions.get(subscriptionId);
    const adapter = adapters.get(subscriptionId);
    if (subscription && adapter && subscription.subscriptionEpoch > selectedEpoch) {
      selected = adapter;
      selectedEpoch = subscription.subscriptionEpoch;
    }
  }
  return selected;
}

export function createProjectAgentAdapterResolvers(
  deps: ProjectAgentAdapterResolverDeps,
): ProjectAgentAdapterResolvers {
  const { subscriptions } = deps;
  const canvasReadFor = (partition: ExecutionPartition, preferredSubscriptionId: string, turnCanvasRead?: PiCanvasReadTransportAdapter) =>
    turnCanvasRead
      ? turnCanvasRead
      : mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.canvasReads);
  const documentReadFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.documentReads);
  const documentWriteFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.documentWrites);
  const canvasWriteFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.canvasWrites);
  const timelineReadFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.timelineReads);
  const timelineWriteFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.timelineWrites);
  const phase4SurfaceFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.phase4Surfaces);
  const skillReadFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.skillReads);
  const skillWriteFor = (partition: ExecutionPartition, preferredSubscriptionId: string) =>
    mostRecentAdapterFor(subscriptions, partition, preferredSubscriptionId, deps.skillWrites);
  const proposalReceiptReaderFor = (partition: ExecutionPartition, preferredSubscriptionId: string) => {
    const currentPreferred = partition.subscriptionIds.has(preferredSubscriptionId)
      ? deps.proposalReceiptReaders.get(preferredSubscriptionId)
      : undefined;
    if (currentPreferred) return currentPreferred;
    let selected: ProjectAgentProposalReceiptReader | undefined;
    let selectedEpoch = -1;
    for (const subscriptionId of partition.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId);
      const reader = deps.proposalReceiptReaders.get(subscriptionId);
      if (subscription && reader && subscription.subscriptionEpoch > selectedEpoch) {
        selected = reader;
        selectedEpoch = subscription.subscriptionEpoch;
      }
    }
    return selected;
  };
  return Object.freeze({
    canvasReadFor,
    documentReadFor,
    documentWriteFor,
    canvasWriteFor,
    timelineReadFor,
    timelineWriteFor,
    phase4SurfaceFor,
    skillReadFor,
    skillWriteFor,
    proposalReceiptReaderFor,
  });
}
