import type { SplitNode } from '../types'

export type PanelExpansionDirection = 'horizontal' | 'vertical'

/** Expand a leaf across the neighboring split at a T junction.
 *
 * For example V(H(A, B), C) becomes H(V(A, C), B) when B expands
 * vertically. Branch ratios keep their axes; all leaf IDs/content survive.
 * Return the original tree when the panel has no eligible neighboring split.
 */
export function expandPanelLayout(
  root: SplitNode,
  panelId: string,
  direction: PanelExpansionDirection
): SplitNode {
  if (root.type === 'leaf') return root

  if (root.direction === direction) {
    for (const outerIndex of [0, 1] as const) {
      const inner = root.children[outerIndex]
      if (inner.type !== 'split' || inner.direction === direction) continue
      for (const panelIndex of [0, 1] as const) {
        const panel = inner.children[panelIndex]
        if (panel.type !== 'leaf' || panel.id !== panelId) continue
        const remaining = inner.children[1 - panelIndex]
        const neighbors: SplitNode = {
          ...root,
          children: outerIndex === 0
            ? [remaining, root.children[1]]
            : [root.children[0], remaining]
        }
        return {
          ...inner,
          children: panelIndex === 0 ? [panel, neighbors] : [neighbors, panel]
        }
      }
    }
  }

  for (const index of [0, 1] as const) {
    const expanded = expandPanelLayout(root.children[index], panelId, direction)
    if (expanded !== root.children[index]) {
      return { ...root, children: index === 0
        ? [expanded, root.children[1]] : [root.children[0], expanded] }
    }
  }
  return root
}

export function canExpandPanel(root: SplitNode | null, panelId: string, direction: PanelExpansionDirection): boolean {
  return !!root && expandPanelLayout(root, panelId, direction) !== root
}
