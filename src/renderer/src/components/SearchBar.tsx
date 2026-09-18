import { useRef } from 'react'
import { SearchIcon } from './icons'
import { useUIStore } from '../stores/useUIStore'

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useUIStore()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="search-container stagger-3">
      <div className="search-wrapper">
        <SearchIcon className="search-icon" />
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="Search..."
          aria-label="Search projects, sessions, and agents"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery ? (
          <button
            className="search-clear"
            aria-label="Clear search"
            onClick={() => { setSearchQuery(''); inputRef.current?.focus() }}
          >
            &times;
          </button>
        ) : (
          <span className="search-shortcut">Ctrl K</span>
        )}
      </div>
    </div>
  )
}
