import { describe, expect, it } from 'vitest'
import { expandPanelLayout, canExpandPanel } from '../expandPanelLayout'
import type { SplitNode, SplitBranch } from '../../types'

const leaf = (id: string, sessionId: string | null = id): SplitNode => ({ type: 'leaf', id, sessionId })
const branch = (id: string, direction: SplitBranch['direction'], children: SplitBranch['children'], ratio = 0.5): SplitBranch =>
  ({ type: 'split', id, direction, ratio, children })

function rectangles(node: SplitNode, box = { x: 0, y: 0, w: 1, h: 1 }): Record<string, typeof box> {
  if (node.type === 'leaf') return { [node.id]: box }
  const [first, second] = node.children
  return node.direction === 'horizontal'
    ? { ...rectangles(first, { ...box, w: box.w * node.ratio }),
        ...rectangles(second, { ...box, x: box.x + box.w * node.ratio, w: box.w * (1 - node.ratio) }) }
    : { ...rectangles(first, { ...box, h: box.h * node.ratio }),
        ...rectangles(second, { ...box, y: box.y + box.h * node.ratio, h: box.h * (1 - node.ratio) }) }
}

describe('directional panel expansion', () => {
  it('turns the requested three-panel layout into a full-height right panel', () => {
    const one = leaf('1'), two = leaf('2'), three = leaf('3')
    const original = branch('rows', 'vertical', [branch('columns', 'horizontal', [one, two]), three])
    const result = expandPanelLayout(original, '2', 'vertical')
    expect(result).toEqual(branch('columns', 'horizontal', [branch('rows', 'vertical', [one, three]), two]))
    expect(rectangles(result)).toEqual({
      '1': { x: 0, y: 0, w: 0.5, h: 0.5 },
      '2': { x: 0.5, y: 0, w: 0.5, h: 1 },
      '3': { x: 0, y: 0.5, w: 0.5, h: 0.5 }
    })
  })

  for (const direction of ['horizontal', 'vertical'] as const) {
    for (const outerIndex of [0, 1] as const) {
      for (const panelIndex of [0, 1] as const) {
        it(`expands ${direction}, outer side ${outerIndex}, panel side ${panelIndex}, preserving proportions`, () => {
          const panel = leaf('target', 'quicknotes:session:parent')
          const neighbor = leaf('neighbor', null)
          const inner = branch('inner', direction === 'horizontal' ? 'vertical' : 'horizontal',
            panelIndex === 0 ? [panel, neighbor] : [neighbor, panel], 0.35)
          const other = branch('other', direction, [leaf('a'), leaf('b')], 0.7)
          const root = branch('root', direction, outerIndex === 0 ? [inner, other] : [other, inner], 0.6)
          const snapshot = JSON.stringify(root)
          const before = rectangles(root)
          const result = expandPanelLayout(root, 'target', direction)
          const after = rectangles(result)
          expect(canExpandPanel(root, 'target', direction)).toBe(true)
          expect(JSON.stringify(root)).toBe(snapshot)
          expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
          expect(Object.values(after).reduce((area, rect) => area + rect.w * rect.h, 0)).toBeCloseTo(1)
          if (direction === 'vertical') {
            expect(after.target).toEqual({ ...before.target, y: 0, h: 1 })
          } else {
            expect(after.target).toEqual({ ...before.target, x: 0, w: 1 })
          }
          // Every node ID and every content assignment survives, without duplicates.
          const nodes = (tree: SplitNode): Array<[string, string | null]> => tree.type === 'leaf'
            ? [[tree.id, tree.sessionId]] : [[tree.id, tree.direction], ...nodes(tree.children[0]), ...nodes(tree.children[1])]
          expect(nodes(result).sort()).toEqual(nodes(root).sort())
          expect(new Set(nodes(result).map(([id]) => id)).size).toBe(nodes(result).length)
        })
      }
    }
  }

  it('only changes the affected nested region', () => {
    const outside = leaf('outside')
    const region = branch('rows', 'vertical', [branch('columns', 'horizontal', [leaf('1'), leaf('2')]), leaf('3')])
    const root = branch('outer', 'horizontal', [outside, region], 0.2)
    const result = expandPanelLayout(root, '2', 'vertical') as SplitBranch
    expect(result.children[0]).toBe(outside)
    expect(result.ratio).toBe(0.2)
    expect(rectangles(result)['2'].x).toBeCloseTo(0.6)
    expect(rectangles(result)['2']).toMatchObject({ y: 0, w: 0.4, h: 1 })
  })

  it('does nothing when no neighboring perpendicular split is available', () => {
    const root = branch('rows', 'vertical', [leaf('1'), branch('nested', 'vertical', [leaf('2'), leaf('3')])])
    for (const id of ['1', '2', 'missing']) {
      for (const direction of ['horizontal', 'vertical'] as const) {
        expect(canExpandPanel(root, id, direction)).toBe(false)
        expect(expandPanelLayout(root, id, direction)).toBe(root)
      }
    }
    expect(canExpandPanel(null, '1', 'vertical')).toBe(false)
  })
})
