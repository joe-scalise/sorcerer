import { useState, useEffect, useRef, useCallback } from 'react'
import { getApi } from '../api/client'
import { MessageSquareIcon, SettingsIcon } from './icons'
import { useSessionStore } from '../stores/useSessionStore'
import { useUIStore } from '../stores/useUIStore'
import { SidebarUpdate } from './Updates'

/** MD5 hash for Gravatar URLs (pure JS, no dependencies) */
function md5(input: string): string {
  function safeAdd(x: number, y: number) {
    const lsw = (x & 0xffff) + (y & 0xffff)
    return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff)
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    const r = safeAdd(safeAdd(a, q), safeAdd(x, t))
    return safeAdd((r << s) | (r >>> (32 - s)), b)
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | (~b & d), a, b, x, s, t) }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & ~d), a, b, x, s, t) }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t) }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | ~d), a, b, x, s, t) }

  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) bytes.push(input.charCodeAt(i))
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const bitLen = input.length * 8
  bytes.push(bitLen & 0xff, (bitLen >> 8) & 0xff, (bitLen >> 16) & 0xff, (bitLen >> 24) & 0xff, 0, 0, 0, 0)

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476
  for (let i = 0; i < bytes.length; i += 64) {
    const m: number[] = []
    for (let j = 0; j < 16; j++) m.push(bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) | (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24))
    let aa = a, bb = b, cc = c, dd = d
    a = ff(a,b,c,d,m[0],7,-680876936); d = ff(d,a,b,c,m[1],12,-389564586); c = ff(c,d,a,b,m[2],17,606105819); b = ff(b,c,d,a,m[3],22,-1044525330)
    a = ff(a,b,c,d,m[4],7,-176418897); d = ff(d,a,b,c,m[5],12,1200080426); c = ff(c,d,a,b,m[6],17,-1473231341); b = ff(b,c,d,a,m[7],22,-45705983)
    a = ff(a,b,c,d,m[8],7,1770035416); d = ff(d,a,b,c,m[9],12,-1958414417); c = ff(c,d,a,b,m[10],17,-42063); b = ff(b,c,d,a,m[11],22,-1990404162)
    a = ff(a,b,c,d,m[12],7,1804603682); d = ff(d,a,b,c,m[13],12,-40341101); c = ff(c,d,a,b,m[14],17,-1502002290); b = ff(b,c,d,a,m[15],22,1236535329)
    a = gg(a,b,c,d,m[1],5,-165796510); d = gg(d,a,b,c,m[6],9,-1069501632); c = gg(c,d,a,b,m[11],14,643717713); b = gg(b,c,d,a,m[0],20,-373897302)
    a = gg(a,b,c,d,m[5],5,-701558691); d = gg(d,a,b,c,m[10],9,38016083); c = gg(c,d,a,b,m[15],14,-660478335); b = gg(b,c,d,a,m[4],20,-405537848)
    a = gg(a,b,c,d,m[9],5,568446438); d = gg(d,a,b,c,m[14],9,-1019803690); c = gg(c,d,a,b,m[3],14,-187363961); b = gg(b,c,d,a,m[8],20,1163531501)
    a = gg(a,b,c,d,m[13],5,-1444681467); d = gg(d,a,b,c,m[2],9,-51403784); c = gg(c,d,a,b,m[7],14,1735328473); b = gg(b,c,d,a,m[12],20,-1926607734)
    a = hh(a,b,c,d,m[5],4,-378558); d = hh(d,a,b,c,m[8],11,-2022574463); c = hh(c,d,a,b,m[11],16,1839030562); b = hh(b,c,d,a,m[14],23,-35309556)
    a = hh(a,b,c,d,m[1],4,-1530992060); d = hh(d,a,b,c,m[4],11,1272893353); c = hh(c,d,a,b,m[7],16,-155497632); b = hh(b,c,d,a,m[10],23,-1094730640)
    a = hh(a,b,c,d,m[13],4,681279174); d = hh(d,a,b,c,m[0],11,-358537222); c = hh(c,d,a,b,m[3],16,-722521979); b = hh(b,c,d,a,m[6],23,76029189)
    a = hh(a,b,c,d,m[9],4,-640364487); d = hh(d,a,b,c,m[12],11,-421815835); c = hh(c,d,a,b,m[15],16,530742520); b = hh(b,c,d,a,m[2],23,-995338651)
    a = ii(a,b,c,d,m[0],6,-198630844); d = ii(d,a,b,c,m[7],10,1126891415); c = ii(c,d,a,b,m[14],15,-1416354905); b = ii(b,c,d,a,m[5],21,-57434055)
    a = ii(a,b,c,d,m[12],6,1700485571); d = ii(d,a,b,c,m[3],10,-1894986606); c = ii(c,d,a,b,m[10],15,-1051523); b = ii(b,c,d,a,m[1],21,-2054922799)
    a = ii(a,b,c,d,m[8],6,1873313359); d = ii(d,a,b,c,m[15],10,-30611744); c = ii(c,d,a,b,m[6],15,-1560198380); b = ii(b,c,d,a,m[13],21,1309151649)
    a = ii(a,b,c,d,m[4],6,-145523070); d = ii(d,a,b,c,m[11],10,-1120210379); c = ii(c,d,a,b,m[2],15,718787259); b = ii(b,c,d,a,m[9],21,-343485551)
    a = safeAdd(a, aa); b = safeAdd(b, bb); c = safeAdd(c, cc); d = safeAdd(d, dd)
  }
  const hex = (n: number) => { let s = ''; for (let i = 0; i < 4; i++) s += ((n >> (i * 8 + 4)) & 0xf).toString(16) + ((n >> (i * 8)) & 0xf).toString(16); return s }
  return hex(a) + hex(b) + hex(c) + hex(d)
}

export function gravatarUrl(email: string, size = 64): string {
  const hash = md5(email.trim().toLowerCase())
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`
}

export function useUserProfile() {
  const [displayName, setDisplayName] = useState('')
  const [initial, setInitial] = useState('')
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setAvatarSrc(null)
      const custom = await getApi().settings.get('display_name')
      if (custom) {
        setDisplayName(custom)
        setInitial(custom.charAt(0).toUpperCase())
      } else {
        const info = await getApi().system.userInfo()
        const formatted = info.username.charAt(0).toUpperCase() + info.username.slice(1)
        setDisplayName(formatted)
        setInitial(formatted.charAt(0))
      }

      const email = await getApi().settings.get('gravatar_email')
      if (email) {
        const url = gravatarUrl(email, 96)
        const img = new Image()
        img.onload = () => setAvatarSrc(url)
        img.onerror = async () => {
          const sysPic = await getApi().system.accountPicture()
          setAvatarSrc(sysPic || null)
        }
        img.src = url
      } else {
        const sysPic = await getApi().system.accountPicture()
        setAvatarSrc(sysPic || null)
      }
    }
    load()

    const handler = () => load()
    window.addEventListener('sorcerer:profile-updated', handler)
    return () => window.removeEventListener('sorcerer:profile-updated', handler)
  }, [])

  return { displayName, initial, avatarSrc }
}

function useClock() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()

    const initialTimeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 60_000)
    }, msUntilNextMinute)

    return () => {
      clearTimeout(initialTimeout)
      if (interval) clearInterval(interval)
    }
  }, [])

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return { time, date }
}

function formatUptime(startTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - startTimestamp
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function useMemoryUsage() {
  const [memoryMB, setMemoryMB] = useState<number | null>(null)
  useEffect(() => {
    let mounted = true
    const poll = () => {
      getApi().system.memoryUsage().then((m) => {
        if (mounted) setMemoryMB(m.totalMB)
      }).catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 10_000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])
  return memoryMB
}

function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function getSessionRunStart(session: { started_at?: number | null; created_at?: number }): number | null {
  return session.started_at || session.created_at || null
}

function normalizeProvider(provider?: string | null): string {
  if (!provider) return 'Default'
  const value = provider.toLowerCase()
  if (value === 'google' || value === 'gemini') return 'Gemini'
  if (value === 'openai') return 'OpenAI'
  if (value === 'anthropic' || value === 'claude') return 'Claude'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatProviderSummary(sessions: any[]): string {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const provider = normalizeProvider(session.provider)
    counts.set(provider, (counts.get(provider) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([provider, count]) => `${provider} ${count}`)
    .join(' · ')
}

function getTopProviders(sessions: any[], limit = 4): Array<{ provider: string; count: number }> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const provider = normalizeProvider(session.provider)
    counts.set(provider, (counts.get(provider) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([provider, count]) => ({ provider, count }))
}

function StatsPopover({ sessions, containerRef, onClose, pinned, onTogglePin }: { sessions: any[]; containerRef: React.RefObject<HTMLDivElement | null>; onClose: () => void; pinned: boolean; onTogglePin: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const memoryMB = useMemoryUsage()

  // Today boundary (midnight local time) in unix seconds
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)

  const liveSessions = sessions.filter((s) => s.status !== 'deleted' && s.status !== 'archived')
  const activeSessions = liveSessions.filter((s) => s.status === 'active')
  const idleSessions = liveSessions.filter((s) => s.status === 'idle')
  const todaySessions = liveSessions.filter((s) => s.created_at && s.created_at >= todayStart)
  const activeProviders = new Set(activeSessions.map((s) => normalizeProvider(s.provider)))
  const todayProviders = new Set(todaySessions.map((s) => normalizeProvider(s.provider)))
  const todayProviderSummary = formatProviderSummary(todaySessions)
  const activeProviderSummary = formatProviderSummary(activeSessions)
  const topTodayProviders = getTopProviders(todaySessions)

  // Oldest active session for "running since"
  const earliestActive = activeSessions
    .filter((s) => getSessionRunStart(s))
    .sort((a, b) => (getSessionRunStart(a) || 0) - (getSessionRunStart(b) || 0))[0]
  const earliestActiveStart = earliestActive ? getSessionRunStart(earliestActive) : null

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const insidePopover = !!popoverRef.current?.contains(target)
      const insideTrigger = !!containerRef.current?.contains(target)
      if (!insidePopover && !insideTrigger) {
        onClose()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [containerRef, onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="stats-popover" ref={popoverRef}>
      <div className="stats-popover-header">
        Today's Activity
        <div className="stats-popover-header-actions">
          <button
            className={`stats-popover-pin ${pinned ? 'stats-popover-pin--active' : ''}`}
            onClick={onTogglePin}
            title={pinned ? 'Unpin stats' : 'Pin stats to sidebar'}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z"/></svg>
          </button>
        </div>
      </div>
      <div className="stats-popover-header stats-popover-header--sub">Sorcerer Sessions</div>
      <div className="stats-popover-grid">
        <div className="stats-popover-stat">
          <span className="stats-popover-value">{activeSessions.length}</span>
          <span className="stats-popover-label">Active now</span>
        </div>
        <div className="stats-popover-stat">
          <span className="stats-popover-value">{todaySessions.length}</span>
          <span className="stats-popover-label">Created today</span>
        </div>
        <div className="stats-popover-stat">
          <span className="stats-popover-value">{idleSessions.length}</span>
          <span className="stats-popover-label">Idle now</span>
        </div>
        <div className="stats-popover-stat">
          <span className="stats-popover-value">{todayProviders.size}</span>
          <span className="stats-popover-label">Providers today</span>
        </div>
      </div>
      {earliestActiveStart && (
        <div className="stats-popover-uptime">
          <span className="stats-popover-uptime-label">Active since</span>
          <span className="stats-popover-uptime-value">
            {formatTime(earliestActiveStart)} ({formatUptime(earliestActiveStart)})
          </span>
        </div>
      )}
      <div className="stats-popover-header stats-popover-header--sub">Provider Mix</div>
      <div className="stats-popover-grid">
        {topTodayProviders.length > 0 ? (
          topTodayProviders.map(({ provider, count }) => (
            <div key={provider} className="stats-popover-stat">
              <span className="stats-popover-value">{count}</span>
              <span className="stats-popover-label">{provider} today</span>
            </div>
          ))
        ) : (
          <div className="stats-popover-stat">
            <span className="stats-popover-value">0</span>
            <span className="stats-popover-label">No sessions today</span>
          </div>
        )}
      </div>
      <div className="stats-popover-footer">
        {todayProviderSummary || 'No sessions created today'}
      </div>
      <div className="stats-popover-footer">
        {activeProviders.size > 0 ? `Active now: ${activeProviderSummary}` : 'No active sessions'}
        {memoryMB !== null && <> · {formatMemory(memoryMB)}</>}
      </div>
    </div>
  )
}

export function PinnedStats() {
  const sessions = useSessionStore((s) => s.sessions)
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
  const liveSessions = sessions.filter((s) => s.status !== 'deleted' && s.status !== 'archived')
  const activeCount = liveSessions.filter((s) => s.status === 'active').length
  const todayCount = liveSessions.filter((s) => s.created_at && s.created_at >= todayStart).length
  const providerCount = new Set(liveSessions.map((s) => normalizeProvider(s.provider))).size
  const earliestActive = liveSessions
    .filter((s) => s.status === 'active')
    .filter((s) => getSessionRunStart(s))
    .sort((a, b) => (getSessionRunStart(a) || 0) - (getSessionRunStart(b) || 0))[0]
  const earliestActiveStart = earliestActive ? getSessionRunStart(earliestActive) : null

  return (
    <div className="pinned-stats">
      <div className="pinned-stats-row">
        <span className="pinned-stats-item">
          <span className="pinned-stats-value">{activeCount.toLocaleString()}</span>
          <span className="pinned-stats-label">active</span>
        </span>
        <span className="pinned-stats-item">
          <span className="pinned-stats-value">{todayCount.toLocaleString()}</span>
          <span className="pinned-stats-label">today</span>
        </span>
        <span className="pinned-stats-item">
          <span className="pinned-stats-value">{providerCount.toLocaleString()}</span>
          <span className="pinned-stats-label">providers</span>
        </span>
        <span className="pinned-stats-period">
          {earliestActiveStart ? `since ${formatUptime(earliestActiveStart)}` : 'all providers'}
        </span>
      </div>
    </div>
  )
}

export function useStatsPinned() {
  const [pinned, setPinned] = useState(() => localStorage.getItem('sorcerer-stats-pinned') === 'true')
  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev
      localStorage.setItem('sorcerer-stats-pinned', String(next))
      return next
    })
  }, [])
  return { pinned, togglePin }
}

export function SidebarFooter({ collapsed, width = 260, pinned, togglePin }: { collapsed: boolean; width?: number; pinned: boolean; togglePin: () => void }) {
  const sessions = useSessionStore((s) => s.sessions)
  const openDialog = useUIStore((s) => s.openDialog)
  const showFeedbackIcon = useUIStore((s) => s.showFeedbackIcon)
  const { displayName, initial, avatarSrc } = useUserProfile()
  const { time, date } = useClock()
  const [showStats, setShowStats] = useState(false)

  const activeCount = sessions.filter((s) => s.status === 'active').length

  // Activity level for presence ring: 0 = none, 1 = low, 2 = high
  const activityLevel = activeCount === 0 ? 0 : activeCount <= 2 ? 1 : 2

  // Responsive breakpoints based on sidebar width
  const showClock = width >= 280
  const showClockDate = width >= 320
  const compact = width < 220

  const handleCloseStats = useCallback(() => setShowStats(false), [])
  const statsTriggerRef = useRef<HTMLDivElement>(null)

  if (collapsed) {
    return (
      <div className="sidebar-footer sidebar-footer--collapsed stagger-10">
        <SidebarUpdate collapsed />
        {showFeedbackIcon && (
          <button className="footer-icon-btn" onClick={() => openDialog('feedback')} title="Give feedback">
            <MessageSquareIcon />
          </button>
        )}
        <button className="footer-settings-btn" onClick={() => openDialog('settings')} aria-label="Settings">
          <SettingsIcon />
        </button>
      </div>
    )
  }

  return (
    <div className={`sidebar-footer stagger-10${compact ? ' sidebar-footer--compact' : ''}`}>
      <SidebarUpdate />
      {showStats && <StatsPopover sessions={sessions} containerRef={statsTriggerRef} onClose={handleCloseStats} pinned={pinned} onTogglePin={togglePin} />}
      <div ref={statsTriggerRef}>
        <button
          className="avatar-ring-btn"
          data-activity={activityLevel}
          onClick={() => setShowStats((current) => !current)}
          aria-label="Toggle session stats"
        >
          <span className="avatar-ring" />
          {avatarSrc ? (
            <img className="user-avatar user-avatar--img" src={avatarSrc} alt={displayName} />
          ) : (
            <div className="user-avatar">{initial}</div>
          )}
        </button>
      </div>
      <div className="user-info">
        <div className="user-info-row">
          <div className="user-name">{displayName}</div>
          {showFeedbackIcon && (
            <button className="footer-icon-btn footer-icon-btn--inline" onClick={() => openDialog('feedback')} title="Give feedback">
              <MessageSquareIcon />
            </button>
          )}
        </div>
      </div>
      {showClock && (
        <div className="footer-clock">
          <span className="footer-clock-time">{time}</span>
          {showClockDate && <span className="footer-clock-date">{date}</span>}
        </div>
      )}
      <button className="footer-settings-btn" onClick={() => openDialog('settings')} aria-label="Settings">
        <SettingsIcon />
      </button>
    </div>
  )
}
