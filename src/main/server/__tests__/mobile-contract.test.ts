import { describe, expect, it } from 'vitest'
import { validateMobileRpcRequest } from '../mobile-contract'

describe('mobile RPC v1 contract', () => {
  it('accepts named params for the explicit remote-control operations', () => {
    expect(validateMobileRpcRequest('session:resume', { sessionId: 'session-1' })).toEqual({
      allowed: true,
      method: 'session:resume',
      args: ['session-1']
    })
    expect(validateMobileRpcRequest('session:list', { projectId: 'project-1' })).toEqual({
      allowed: true,
      method: 'session:list',
      args: ['project-1']
    })
    expect(validateMobileRpcRequest('theme:get', {})).toEqual({
      allowed: true,
      method: 'theme:get',
      args: []
    })
  })

  it('does not inherit desktop RPC methods or arbitrary settings access', () => {
    expect(validateMobileRpcRequest('settings:get', { key: 'apiKey_openai' })).toEqual({
      allowed: false,
      reason: 'method_not_allowed'
    })
    expect(validateMobileRpcRequest('settings:set', { key: 'theme', value: 'light' })).toEqual({
      allowed: false,
      reason: 'method_not_allowed'
    })
    expect(validateMobileRpcRequest('project:remove', { id: 'project-1' })).toEqual({
      allowed: false,
      reason: 'method_not_allowed'
    })
  })

  it('rejects positional params, missing identifiers, and unexpected keys', () => {
    expect(validateMobileRpcRequest('agent:resume', ['agent-1']).allowed).toBe(false)
    expect(validateMobileRpcRequest('agent:resume', {}).allowed).toBe(false)
    expect(validateMobileRpcRequest('agent:resume', {
      agentId: 'agent-1',
      admin: true
    }).allowed).toBe(false)
    expect(validateMobileRpcRequest('theme:get', { key: 'remoteAuthToken' }).allowed).toBe(false)
  })
})
