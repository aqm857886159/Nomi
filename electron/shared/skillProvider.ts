import { z } from "zod";
export const skillProviderKindSchema = z.enum(["text", "image", "video"]);
export type SkillProviderKind = z.infer<typeof skillProviderKindSchema>;
