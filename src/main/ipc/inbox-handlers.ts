import type { DatabaseService } from '../services/database-service'
import type { InboxCreateInput, InboxUpdateInput } from '../../shared/inbox'

type InboxServices = { db: DatabaseService }

export const listInboxItems = ({ db }: InboxServices) => db.listInboxItems()
export const createInboxItem = ({ db }: InboxServices, input: InboxCreateInput) => db.createInboxItem(input)
export const updateInboxItem = ({ db }: InboxServices, id: string, input: InboxUpdateInput) => db.updateInboxItem(id, input)
export const reorderInboxItem = ({ db }: InboxServices, id: string, targetId: string) => db.reorderInboxItem(id, targetId)
export const deleteInboxItem = ({ db }: InboxServices, id: string) => db.deleteInboxItem(id)
