import { PlusIcon, FolderPlusIcon, BotIcon } from './icons'
import { useUIStore } from '../stores/useUIStore'
import { getFeatures } from '../features'

export function ActionBar({ collapsed }: { collapsed: boolean }) {
  const { openDialog } = useUIStore()

  if (collapsed) {
    return (
      <div className="action-bar action-bar--collapsed stagger-2">
        <button className="action-btn action-btn--icon action-btn--primary-icon" onClick={() => openDialog('new-session')}>
          <PlusIcon />
        </button>
        {getFeatures().standaloneAgents && <button className="action-btn action-btn--icon" onClick={() => openDialog('add-agent')} title="New Agent">
          <BotIcon />
        </button>}
        <button className="action-btn action-btn--icon" onClick={() => openDialog('add-project')}>
          <FolderPlusIcon />
        </button>
      </div>
    )
  }

  return (
    <div className="action-bar stagger-2">
      <button className="action-btn action-btn--primary" onClick={() => openDialog('new-session')}>
        <PlusIcon />
        <span>New Session</span>
      </button>
      {getFeatures().standaloneAgents && <button className="action-btn action-btn--icon" onClick={() => openDialog('add-agent')} title="New Agent">
        <BotIcon />
      </button>}
      <button className="action-btn action-btn--icon" onClick={() => openDialog('add-project')}>
        <FolderPlusIcon />
      </button>
    </div>
  )
}
