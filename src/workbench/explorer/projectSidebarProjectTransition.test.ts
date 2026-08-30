import { describe, expect, it } from 'vitest'
import { observeProjectSidebarTransition } from './projectSidebarProjectTransition'

describe('observeProjectSidebarTransition', () => {
  it('does not override the user on first project mount or same-project rerenders', () => {
    expect(observeProjectSidebarTransition('', 'project-a')).toEqual({ lastProjectId: 'project-a', collapse: false })
    expect(observeProjectSidebarTransition('project-a', 'project-a')).toEqual({ lastProjectId: 'project-a', collapse: false })
  })

  it('collapses once when the real project id changes and ignores a transient empty id', () => {
    expect(observeProjectSidebarTransition('project-a', null)).toEqual({ lastProjectId: 'project-a', collapse: false })
    expect(observeProjectSidebarTransition('project-a', 'project-b')).toEqual({ lastProjectId: 'project-b', collapse: true })
  })
})
