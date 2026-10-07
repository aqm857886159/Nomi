import { z } from 'zod'

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const aiSceneElementSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  position: vec3Schema.optional(),
  rotation: vec3Schema.optional(),
  scale: vec3Schema.optional(),
  color: z.string().optional(),
  roughness: z.number().optional(),
  metalness: z.number().optional(),
  opacity: z.number().optional(),
  wireframe: z.boolean().optional(),
  flatShading: z.boolean().optional(),
})

export const aiSceneSchema = z.object({
  sceneName: z.string().optional(),
  sceneConfig: z.object({ skyColor: z.string().optional(), groundOpacity: z.number().optional() }).optional(),
  groups: z.array(z.object({ name: z.string().optional(), elements: z.array(aiSceneElementSchema).default([]) })).min(1),
})

export type AiSceneSpec = z.infer<typeof aiSceneSchema>
export type AiSceneElement = z.infer<typeof aiSceneElementSchema>
export type AiSceneGroup = AiSceneSpec['groups'][number]

