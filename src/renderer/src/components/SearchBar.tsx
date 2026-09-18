import { useEffect, useRef } from 'react'
import { SearchIcon } from './icons'
import { useUIStore } from '../stores/useUIStore'
import { getFeatures } from '../features'

export function SearchBar() {
  const { searchQuery, setSearchQuery, searchOpen, closeSearch } = useUIStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = searchOpen || Boolean(searchQuery)

  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  if (!visible) return null

  return (
    <div className="search-container" id="sidebar-search">
      <div className="search-wrapper">
        <SearchIcon className="search-icon" />
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="Search…"
          aria-label={getFeatures().standaloneAgents ? 'Search projects, sessions, and agents' : 'Search projects and sessions'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className="search-clear"
          aria-label={searchQuery ? 'Clear search' : 'Close search'}
          title={searchQuery ? 'Clear search (Esc)' : 'Close search (Esc)'}
          onClick={() => {
            if (searchQuery) {
              setSearchQuery('')
              inputRef.current?.focus()
            } else {
              closeSearch()
              document.querySelector<HTMLButtonElement>('.sidebar-search-toggle')?.focus()
            }
          }}
        >
          &times;
        </button>
      </div>
    </div>
  )
}
