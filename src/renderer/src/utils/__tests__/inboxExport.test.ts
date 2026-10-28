import { describe, expect, it } from 'vitest'
import { inboxToCsv } from '../inboxExport'
import type { InboxItem } from '../../../../shared/inbox'
import type { Project } from '../../types'

describe('inbox CSV export', () => {
  it('preserves quotes, commas, newlines and project names while protecting spreadsheet formulas', () => {
    const items: InboxItem[] = [{ id: '1', title: '=SUM(1,2)', body: 'A "quote"\nnext line', project_id: 'p', pinned: true, status: 'done', created_at: 0, updated_at: 0 }]
    const projects: Project[] = [{ id: 'p', name: 'Project, one', path: '/tmp/project' }]
    expect(inboxToCsv(items, projects)).toBe('\ufeff"Title","Details","Project","Status","Pinned","Created"\r\n"\'=SUM(1,2)","A ""quote""\nnext line","Project, one","done","Yes","1970-01-01T00:00:00.000Z"\r\n')
  })
})
