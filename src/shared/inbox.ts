/** Human-owned captures. Deliberately independent of sessions and providers. */
export type InboxStatus = 'open' | 'done' | 'archived'

export interface InboxItem {
  id: string
  title: string
  body: string
  project_id: string | null
  pinned: boolean
  status: InboxStatus
  created_at: number
  updated_at: number
  sort_order?: number | null
}

export interface InboxCreateInput {
  title: string
  body?: string
  project_id?: string | null
}

export interface InboxUpdateInput extends Partial<InboxCreateInput> {
  pinned?: boolean
  status?: InboxStatus
}

export const INBOX_TITLE_LIMIT = 500
export const INBOX_BODY_LIMIT = 20_000

export function validateInboxInput(input: unknown, partial: boolean): InboxUpdateInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid inbox item.')
  const fields = input as Record<string, unknown>
  const allowed = partial
    ? ['title', 'body', 'project_id', 'pinned', 'status']
    : ['title', 'body', 'project_id']
  if (Object.keys(fields).some((key) => !allowed.includes(key))) throw new Error('Unsupported inbox field.')
  const result: InboxUpdateInput = {}
  if (!partial || 'title' in fields) {
    if (
      typeof fields.title !== 'string' ||
      !fields.title.trim() ||
      fields.title.trim().length > INBOX_TITLE_LIMIT
    ) {
      throw new Error(`Add a title of 1–${INBOX_TITLE_LIMIT} characters.`)
    }
    result.title = fields.title.trim()
  }
  if ('body' in fields) {
    if (typeof fields.body !== 'string' || fields.body.length > INBOX_BODY_LIMIT)
      throw new Error('Inbox details are too long or invalid.')
    result.body = fields.body
  }
  if ('project_id' in fields) {
    if (
      fields.project_id !== null &&
      (typeof fields.project_id !== 'string' || !fields.project_id || fields.project_id.length > 256)
    ) {
      throw new Error('Choose a valid project or no project.')
    }
    result.project_id = fields.project_id as string | null
  }
  if ('pinned' in fields) {
    if (typeof fields.pinned !== 'boolean') throw new Error('Invalid pin state.')
    result.pinned = fields.pinned
  }
  if ('status' in fields) {
    if (!['open', 'done', 'archived'].includes(fields.status as string))
      throw new Error('Invalid inbox status.')
    result.status = fields.status as InboxStatus
  }
  return result
}
