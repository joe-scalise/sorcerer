import type { SplitNode } from '../types'

/** Drop unavailable saved targets without leaving abandoned split panes. */
export function restoreSplitLayout(node: SplitNode, isAvailable: (id: string) => boolean): SplitNode | null {
  if (node.type === 'leaf') return node.sessionId && !isAvailable(node.sessionId) ? null : node
  const left = restoreSplitLayout(node.children[0], isAvailable)
  const right = restoreSplitLayout(node.children[1], isAvailable)
  if (!left) return right
  if (!right) return left
  return { ...node, children: [left, right] }
}
