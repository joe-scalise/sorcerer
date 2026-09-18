export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'

/** Main-process snapshot. Revisions prevent late IPC replies replacing newer events. */
export interface UpdateState {
  revision: number
  status: UpdateStatus
  currentVersion: string
  version?: string
  url?: string
  releaseNotes?: string
  progress?: number
  error?: string
  checkedAt?: number
  managed: boolean
  downloaded: boolean
  canDownload: boolean
}

export interface UpdateAPI {
  getState(): Promise<UpdateState>
  check(): Promise<UpdateState>
  download(): Promise<UpdateState>
  install(): Promise<UpdateState>
  onState(callback: (state: UpdateState) => void): () => void
  onPrepareInstall(callback: (requestId: string) => void): () => void
  prepared(requestId: string, ok: boolean, error?: string): void
}
