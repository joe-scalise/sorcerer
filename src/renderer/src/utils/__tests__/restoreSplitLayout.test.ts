import { describe, expect, it } from 'vitest'
import { restoreSplitLayout } from '../restoreSplitLayout'
import type { SplitNode } from '../../types'

describe('restoring Projects without standalone Agents', () => {
  const project: SplitNode = { type: 'leaf', id: 'project-pane', sessionId: 'project-session' }
  const agent: SplitNode = { type: 'leaf', id: 'agent-pane', sessionId: 'saved-agent' }
  const notes: SplitNode = { type: 'leaf', id: 'agent-notes', sessionId: 'quicknotes:agent:saved-agent' }
  const layout: SplitNode = {
    type: 'split', id: 'root', direction: 'horizontal', ratio: 0.4,
    children: [project, { type: 'split', id: 'agent-split', direction: 'vertical', ratio: 0.5, children: [agent, notes] }]
  }

  it('gives the project full space and leaves the saved source layout untouched', () => {
    const before = JSON.stringify(layout)
    expect(restoreSplitLayout(layout, (id) => id === 'project-session')).toEqual(project)
    expect(JSON.stringify(layout)).toBe(before)
  })

  it('keeps enabled Agent panes and deliberately empty project panes', () => {
    expect(restoreSplitLayout(layout, () => true)).toEqual(layout)
    const empty: SplitNode = { type: 'leaf', id: 'empty', sessionId: null }
    expect(restoreSplitLayout(empty, () => false)).toEqual(empty)
  })

  it('returns the normal empty workspace when every restored target is unavailable', () => {
    expect(restoreSplitLayout(layout, () => false)).toBeNull()
  })
})
