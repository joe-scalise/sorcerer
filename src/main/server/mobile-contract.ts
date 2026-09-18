export const MOBILE_PROTOCOL_VERSION = 1 as const

export const MOBILE_CAPABILITIES = [
  'pairing.one-time.v1',
  'rpc.mobile.v1',
  'terminal.websocket.v1',
  'devices.revoke.v1'
] as const

export const MOBILE_RPC_METHODS = [
  'project:list',
  'session:list',
  'session:resume',
  'session:restart',
  'agent:list',
  'agent:resume',
  'agent:restart',
  'theme:get'
] as const

export type MobileRpcMethod = typeof MOBILE_RPC_METHODS[number]

export const MOBILE_SCOPES = {
  rpc: 'mobile:rpc',
  terminalRead: 'terminal:read',
  terminalWrite: 'terminal:write'
} as const

export const DEFAULT_MOBILE_SCOPES = [
  MOBILE_SCOPES.rpc,
  MOBILE_SCOPES.terminalRead,
  MOBILE_SCOPES.terminalWrite
]

export const MOBILE_PROTOCOL_INFO = {
  protocolVersion: MOBILE_PROTOCOL_VERSION,
  minClientProtocolVersion: MOBILE_PROTOCOL_VERSION,
  capabilities: [...MOBILE_CAPABILITIES],
  endpoints: {
    pair: '/api/mobile/v1/pair',
    rpc: '/api/mobile/v1/rpc',
    websocket: '/ws',
    remoteControl: '/rc'
  },
  rpcMethods: [...MOBILE_RPC_METHODS],
  websocketAuthentication: 'first-message' as const
}

export type MobileRpcDecision =
  | { allowed: true; method: MobileRpcMethod; args: unknown[] }
  | { allowed: false; reason: 'method_not_allowed' | 'invalid_arguments' }

/**
 * Validate the complete mobile RPC surface, including argument shapes. Keeping
 * this separate from the desktop dispatch map prevents newly-added desktop RPC
 * methods from silently becoming remotely callable.
 */
export function validateMobileRpcRequest(method: unknown, params: unknown): MobileRpcDecision {
  if (typeof method !== 'string' || !MOBILE_RPC_METHODS.includes(method as MobileRpcMethod)) {
    return { allowed: false, reason: 'method_not_allowed' }
  }
  if (!isRecord(params)) return { allowed: false, reason: 'invalid_arguments' }

  switch (method as MobileRpcMethod) {
    case 'project:list':
    case 'agent:list':
    case 'theme:get':
      return hasOnlyKeys(params, [])
        ? { allowed: true, method: method as MobileRpcMethod, args: [] }
        : { allowed: false, reason: 'invalid_arguments' }

    case 'session:list':
      return (
        hasOnlyKeys(params, ['projectId']) &&
        (params.projectId === undefined || typeof params.projectId === 'string')
      )
        ? {
            allowed: true,
            method: 'session:list',
            args: params.projectId === undefined ? [] : [params.projectId]
          }
        : { allowed: false, reason: 'invalid_arguments' }

    case 'session:resume':
    case 'session:restart': {
      const sessionId = params.sessionId
      return hasOnlyKeys(params, ['sessionId']) && typeof sessionId === 'string' && sessionId.length > 0
        ? { allowed: true, method: method as MobileRpcMethod, args: [sessionId] }
        : { allowed: false, reason: 'invalid_arguments' }
    }

    case 'agent:resume':
    case 'agent:restart': {
      const agentId = params.agentId
      return hasOnlyKeys(params, ['agentId']) && typeof agentId === 'string' && agentId.length > 0
        ? { allowed: true, method: method as MobileRpcMethod, args: [agentId] }
        : { allowed: false, reason: 'invalid_arguments' }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key))
}
