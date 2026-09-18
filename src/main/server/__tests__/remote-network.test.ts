import { describe, expect, it } from 'vitest'
import {
  buildAndroidPairingIntent,
  isSafeAutomaticallyAdvertisedIpv4,
  normalizePairingHost,
  parseRemotePort
} from '../remote-network'

describe('remote network validation', () => {
  it('normalizes the host forms accepted by Android', () => {
    expect(normalizePairingHost('192.168.001.008')).toBe('192.168.1.8')
    expect(normalizePairingHost('Desktop.Local.')).toBe('desktop.local')
    expect(normalizePairingHost('bücher.local')).toBe('xn--bcher-kva.local')
    expect(normalizePairingHost('[2001:0DB8:0:0:0:0:0:7]')).toBe('2001:db8::7')
  })

  it('rejects host forms that would produce an unusable or unsafe QR link', () => {
    for (const host of [
      'desktop_name',
      '300.2.3.4',
      'fe80::1%wlan0',
      'fe80::1',
      '[192.168.1.8',
      '192.168.1.8]',
      '127.0.0.1',
      '::1',
      'ff02::1',
      'http://desktop.local'
    ]) {
      expect(() => normalizePairingHost(host), host).toThrow()
    }
  })

  it('accepts only integer ports in range', () => {
    expect(parseRemotePort('7437')).toBe(7437)
    expect(parseRemotePort(65535)).toBe(65535)
    expect(() => parseRemotePort('NaN')).toThrow()
    expect(() => parseRemotePort(70000)).toThrow()
    expect(() => parseRemotePort(1023, 1024)).toThrow()
  })

  it('binds QR dispatch to the production Android package', () => {
    const intent = buildAndroidPairingIntent({
      scheme: 'http',
      host: '192.168.1.8',
      port: 7437,
      code: 'one_time_code',
      protocolVersion: 1
    })

    expect(intent).toBe(
      'intent://pair?scheme=http&host=192.168.1.8&port=7437&code=one_time_code&v=1' +
      '#Intent;scheme=sorcerer-remote;package=com.aetherci.sorcerer.remote;end'
    )
    expect(intent).not.toContain('token=')
  })

  it('automatically advertises only private LAN or VPN IPv4 space', () => {
    for (const address of ['10.2.3.4', '100.64.1.2', '172.31.4.5', '192.168.50.8']) {
      expect(isSafeAutomaticallyAdvertisedIpv4(address), address).toBe(true)
    }
    for (const address of ['8.8.8.8', '169.254.2.3', '127.0.0.1', '203.0.113.10']) {
      expect(isSafeAutomaticallyAdvertisedIpv4(address), address).toBe(false)
    }
  })
})
