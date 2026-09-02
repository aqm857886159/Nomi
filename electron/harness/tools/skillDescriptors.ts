import { z } from 'zod';
import type { AgentToolDescriptor } from './agentToolCatalog';

/** Read-only resource access. Loading a Skill never grants its declared capabilities. */
export const skillToolDescriptors: Readonly<Record<string, AgentToolDescriptor>> = Object.freeze({
  load_skill: {
    name: 'load_skill',
    description: 'Load one named Nomi Skill from the approved repository/user catalog. Read-only; it does not grant tools.',
    parameters: z.object({
      name: z.string().trim().min(1),
      expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    }).strict(),
  },
});
