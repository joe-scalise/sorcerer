/** Provider-owned plans; the host owns database writes and PTY processes. */
export interface ProviderSessionPlan {
  id: string
  args: string[]
}

export interface ProviderExternalSession {
  id: string
  cwd: string
  title: string
  createdAt: number
  updatedAt: number
  model: string
}

export interface ProviderSessionBackend {
  label: string
  fresh(): ProviderSessionPlan
  resume(id: string | null | undefined, cwd: string): ProviderSessionPlan
  validate(id: string | null | undefined, cwd: string): boolean
  discover(): ProviderExternalSession[]
}
