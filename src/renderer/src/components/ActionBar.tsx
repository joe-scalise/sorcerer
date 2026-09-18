import { PlusIcon, FolderPlusIcon, BotIcon, SearchIcon } from './icons'
import { useUIStore } from '../stores/useUIStore'
import { getFeatures } from '../features'

export function ActionBar({ collapsed }: { collapsed: boolean }) {
  const { openDialog, openSearch, searchOpen, searchQuery } = useUIStore()

  return (
    <div className={`action-bar stagger-2${collapsed ? ' action-bar--collapsed' : ''}`}>
      <button
        className={`action-btn ${collapsed ? 'action-btn--icon' : 'action-btn--new-session'}`}
        onClick={() => openDialog('new-session')}
        aria-label="New session"
        title="New session (Ctrl+N)"
      >
        <PlusIcon />
        {!collapsed && <span>New session</span>}
      </button>
      {getFeatures().standaloneAgents && <button className="action-btn action-btn--icon" onClick={() => openDialog('add-agent')} aria-label="New Agent" title="New Agent">
        <BotIcon />
      </button>}
      {collapsed && <button className="action-btn action-btn--icon" onClick={() => openDialog('add-project')} aria-label="Add project" title="Add project">
        <FolderPlusIcon />
      </button>}
      <button
        className={`action-btn action-btn--icon sidebar-search-toggle${searchQuery ? ' action-btn--search-active' : ''}`}
        onClick={() => {
          openSearch()
          document.querySelector<HTMLInputElement>('.search-input')?.focus()
        }}
        aria-label={searchQuery ? 'Search (filter active)' : 'Search'}
        title="Search (Ctrl+K)"
        aria-expanded={!collapsed && Boolean(searchOpen || searchQuery)}
        aria-controls={!collapsed && (searchOpen || searchQuery) ? 'sidebar-search' : undefined}
      >
        <SearchIcon />
      </button>
    </div>
  )
}
