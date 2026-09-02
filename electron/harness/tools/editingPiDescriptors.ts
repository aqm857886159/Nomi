import { z } from 'zod'
import * as assetRead from '../../shared/agentCapabilities/assetRead'
import type { CapabilityContract } from '../../shared/agentCapabilities/capabilityContract'
import * as exportCapabilities from '../../shared/agentCapabilities/exportCapabilities'
import * as timelineRead from '../../shared/agentCapabilities/timelineRead'
import * as timelineWrite from '../../shared/agentCapabilities/timelineWrite'
import { capabilityAliasesFor, capabilityOperationAliasesFor } from '../../shared/agentCapabilities/registry'

export type EditingPiDescriptor = Readonly<{
  name: string
  description: string
  parameters: z.ZodTypeAny
}>

type PiDescriptorFactory = Readonly<{
  capability: CapabilityContract<unknown, unknown>
  descriptionForAlias: (alias: string) => string | undefined
  schemaForAlias: (alias: string) => z.ZodTypeAny | undefined
}>

function descriptorsForFactory(factory: PiDescriptorFactory): EditingPiDescriptor[] {
  const aliases = [
    ...capabilityAliasesFor(factory.capability.id, 'pi'),
    ...capabilityOperationAliasesFor(factory.capability.id, 'pi'),
  ]
  return aliases.map((alias) => ({
    name: alias,
    description: factory.descriptionForAlias(alias) ?? factory.capability.projections.pi?.description ?? factory.capability.id,
    parameters: factory.schemaForAlias(alias) ?? z.never(),
  }))
}

const EDITING_PI_FACTORIES: readonly PiDescriptorFactory[] = [
  { capability: assetRead.ASSET_READ_CAPABILITY, descriptionForAlias: assetRead.assetReadPiDescriptionForAlias, schemaForAlias: assetRead.assetReadPiInputSchemaForAlias },
  { capability: exportCapabilities.EXPORT_READ_CAPABILITY, descriptionForAlias: exportCapabilities.exportReadPiDescriptionForAlias, schemaForAlias: exportCapabilities.exportReadPiInputSchemaForAlias },
  { capability: exportCapabilities.EXPORT_WRITE_CAPABILITY, descriptionForAlias: exportCapabilities.exportWritePiDescriptionForAlias, schemaForAlias: exportCapabilities.exportWritePiInputSchemaForAlias },
  { capability: timelineRead.TIMELINE_READ_CAPABILITY, descriptionForAlias: timelineRead.timelineReadPiDescriptionForAlias, schemaForAlias: timelineRead.timelineReadPiInputSchemaForAlias },
  { capability: timelineWrite.TIMELINE_WRITE_CAPABILITY, descriptionForAlias: timelineWrite.timelineWritePiDescriptionForAlias, schemaForAlias: timelineWrite.timelineWritePiInputSchemaForAlias },
]

/** Pi keeps established internal aliases; MCP exposes the semantic manifest instead. */
export const editingPiDescriptors = Object.freeze(
  EDITING_PI_FACTORIES.flatMap(descriptorsForFactory),
)
