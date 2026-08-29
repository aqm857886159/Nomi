import { z } from 'zod'
import {
  ASSET_READ_CAPABILITY,
  assetReadPiDescriptionForAlias,
  assetReadPiInputSchemaForAlias,
} from '../../shared/agentCapabilities/assetRead'
import type { CapabilityContract } from '../../shared/agentCapabilities/capabilityContract'
import {
  EXPORT_READ_CAPABILITY,
  EXPORT_WRITE_CAPABILITY,
  exportReadPiDescriptionForAlias,
  exportReadPiInputSchemaForAlias,
  exportWritePiDescriptionForAlias,
  exportWritePiInputSchemaForAlias,
} from '../../shared/agentCapabilities/exportCapabilities'
import {
  TIMELINE_READ_CAPABILITY,
  timelineReadPiDescriptionForAlias,
  timelineReadPiInputSchemaForAlias,
} from '../../shared/agentCapabilities/timelineRead'
import {
  TIMELINE_WRITE_CAPABILITY,
  timelineWritePiDescriptionForAlias,
  timelineWritePiInputSchemaForAlias,
} from '../../shared/agentCapabilities/timelineWrite'
import { capabilityAliasesFor, capabilityOperationAliasesFor } from '../../shared/agentCapabilities/registry'

export { timelineEditPlanSchema, timelineOperationSchema } from '../../shared/agentCapabilities/timelineRead'

type TimelineDescriptor = Readonly<{ name: string; description: string; parameters: z.ZodTypeAny }>

function registryDescriptors(
  capability: CapabilityContract<unknown, unknown>,
  descriptionForAlias: (alias: string) => string | undefined,
  schemaForAlias: (alias: string) => z.ZodTypeAny | undefined,
): Record<string, TimelineDescriptor> {
  const aliases = [
    ...capabilityAliasesFor(capability.id, 'pi'),
    ...capabilityOperationAliasesFor(capability.id, 'pi'),
  ]
  return Object.fromEntries(aliases.map((alias) => [alias, {
    name: alias,
    description: descriptionForAlias(alias) ?? capability.projections.pi?.description ?? capability.id,
    parameters: schemaForAlias(alias) ?? z.never(),
  }]))
}

const timelineCapabilityToolDescriptors = {
  ...registryDescriptors(
    ASSET_READ_CAPABILITY,
    assetReadPiDescriptionForAlias,
    assetReadPiInputSchemaForAlias,
  ),
  ...registryDescriptors(
    EXPORT_READ_CAPABILITY,
    exportReadPiDescriptionForAlias,
    exportReadPiInputSchemaForAlias,
  ),
  ...registryDescriptors(
    EXPORT_WRITE_CAPABILITY,
    exportWritePiDescriptionForAlias,
    exportWritePiInputSchemaForAlias,
  ),
  ...registryDescriptors(
    TIMELINE_READ_CAPABILITY,
    timelineReadPiDescriptionForAlias,
    timelineReadPiInputSchemaForAlias,
  ),
  ...registryDescriptors(
    TIMELINE_WRITE_CAPABILITY,
    timelineWritePiDescriptionForAlias,
    timelineWritePiInputSchemaForAlias,
  ),
}

export const timelineToolDescriptors = {
  ...timelineCapabilityToolDescriptors,
} as const

export type TimelineToolName = keyof typeof timelineToolDescriptors
export const timelineToolNames = Object.keys(timelineToolDescriptors) as TimelineToolName[]
