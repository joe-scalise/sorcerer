import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const IPV4_SHAPE = /^[0-9.]+$/
export const ANDROID_REMOTE_PACKAGE = 'com.aetherci.sorcerer.remote'

export class RemoteNetworkValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteNetworkValidationError'
  }
}

/**
 * Normalize a desktop address using the same rules as the Android client.
 * Keeping this server-side prevents the desktop from minting unusable QR links.
 */
export function normalizePairingHost(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RemoteNetworkValidationError('Phone address must be a string.')
  }

  let candidate = value.trim()
  if (candidate.startsWith('[') || candidate.endsWith(']')) {
    if (!(candidate.startsWith('[') && candidate.endsWith(']'))) {
      throw invalidHost('IPv6 brackets are incomplete.')
    }
    candidate = candidate.slice(1, -1)
  }

  if (!candidate) throw invalidHost('Phone address is required.')
  if (candidate.length > 253) throw invalidHost('Phone address is too long.')
  if (/\s/.test(candidate) || /[/?#@]/.test(candidate)) {
    throw invalidHost('Enter an IP address or DNS name, not a URL.')
  }

  if (candidate.includes(':')) return normalizeIpv6(candidate)
  if (IPV4_SHAPE.test(candidate)) return normalizeIpv4(candidate)
  return normalizeDns(candidate)
}

export function parseRemotePort(value: unknown, minimum = 1): number {
  const port = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[0-9]+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN

  if (!Number.isSafeInteger(port) || port < minimum || port > 65535) {
    throw new RemoteNetworkValidationError(
      `Port must be an integer between ${minimum} and 65535.`
    )
  }
  return port
}

export function buildAndroidPairingIntent(input: {
  scheme: 'http' | 'https'
  host: string
  port: number
  code: string
  protocolVersion: number
}): string {
  const query = new URLSearchParams({
    scheme: input.scheme,
    host: normalizePairingHost(input.host),
    port: String(parseRemotePort(input.port)),
    code: input.code,
    v: String(input.protocolVersion)
  }).toString()
  return `intent://pair?${query}#Intent;scheme=sorcerer-remote;package=${ANDROID_REMOTE_PACKAGE};end`
}

/** Only automatically advertise private LAN or carrier-grade-NAT IPv4 space. */
export function isSafeAutomaticallyAdvertisedIpv4(value: string): boolean {
  let host: string
  try {
    host = normalizeIpv4(value.trim())
  } catch {
    return false
  }

  const [first, second] = host.split('.').map(Number)
  return (
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function normalizeIpv4(candidate: string): string {
  const pieces = candidate.split('.')
  if (pieces.length !== 4 || pieces.some((piece) => !piece || piece.length > 3)) {
    throw invalidHost('IPv4 addresses must contain four octets.')
  }
  const octets = pieces.map((piece) => Number(piece))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw invalidHost('IPv4 octets must be between 0 and 255.')
  }
  if (octets[0] === 0 || octets[0] === 127 || octets[0] >= 224 || octets.every((octet) => octet === 255)) {
    throw invalidHost('Use an address reachable from the phone.')
  }
  return octets.join('.')
}

function normalizeIpv6(candidate: string): string {
  if (candidate.includes('%') || isIP(candidate) !== 6) {
    throw invalidHost('IPv6 address is invalid or uses an unsupported scope ID.')
  }

  let normalized: string
  try {
    normalized = new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase()
  } catch {
    throw invalidHost('IPv6 address is invalid.')
  }

  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16)
  const isLinkLocal = (firstHextet & 0xffc0) === 0xfe80

  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:') ||
    isLinkLocal
  ) {
    throw invalidHost('Use an address reachable from the phone.')
  }
  return normalized
}

function normalizeDns(candidate: string): string {
  const ascii = domainToASCII(candidate.replace(/\.$/, '')).toLowerCase()
  if (
    !ascii ||
    ascii === 'localhost' ||
    ascii.length > 253 ||
    ascii.split('.').some((label) => !DNS_LABEL.test(label))
  ) {
    throw invalidHost('DNS name is invalid.')
  }
  return ascii
}

function invalidHost(detail: string): RemoteNetworkValidationError {
  return new RemoteNetworkValidationError(
    `${detail} Enter a valid LAN IP address or DNS name for the Android connection.`
  )
}
