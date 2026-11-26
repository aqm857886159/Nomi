import fs from 'node:fs'
import path from 'node:path'
import { seedOldUserData } from '../world'
import { bindWorkspaceLocation } from '../../electron/workspace/workspaceRegistry'
import type { WorkbenchProjectRecordV1 } from '../../src/workbench/project/projectRecordSchema'

/** Register only isolated copies. The v0.24.1 lastKnownRootPath is a historical hint. */
export function openFixtureWorld() {
  const world = seedOldUserData('projects/v0.24.1-readonly-open')
  try {
    const projects = fs.readdirSync(world.projectsDir).map(folder => {
      const rootPath = path.join(world.projectsDir, folder)
      const file = path.join(rootPath, '.nomi/project.json')
      const read = (): WorkbenchProjectRecordV1 => JSON.parse(fs.readFileSync(file, 'utf8'))
      const { id, name } = read()
      bindWorkspaceLocation(world.settingsDir, { id, name, rootPath })
      return { id, name, rootPath, file, read }
    })
    return { world, projects }
  } catch (error) {
    world.cleanup()
    throw error
  }
}
