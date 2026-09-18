package com.aetherci.sorcerer.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionEndpointTest {
  @Test
  fun `normalizes IPv4 DNS and bracketed IPv6 hosts`() {
    assertEquals("192.168.1.8", valid("http", "192.168.001.008", 7437).host)
    assertEquals("desktop.local", valid("https", "Desktop.Local.", 443).host)

    val ipv6 = valid("http", "[2001:db8::7]", 7437)
    assertTrue(ipv6.host.contains(':'))
    assertTrue(ipv6.origin.startsWith("http://["))
    assertTrue(ipv6.origin.endsWith("]:7437"))
  }

  @Test
  fun `rejects URLs invalid addresses loopback and invalid ports`() {
    assertInvalid("http", "http://desktop.local", 7437, EndpointField.HOST)
    assertInvalid("http", "300.2.3.4", 7437, EndpointField.HOST)
    assertInvalid("http", "127.0.0.1", 7437, EndpointField.HOST)
    assertInvalid("http", "::1", 7437, EndpointField.HOST)
    assertInvalid("https", "fe80::1", 443, EndpointField.HOST)
    assertInvalid("ftp", "desktop.local", 7437, EndpointField.SCHEME)
    assertInvalid("http", "desktop.local", 0, EndpointField.PORT)
    assertInvalid("http", "desktop.local", 65536, EndpointField.PORT)
  }

  @Test
  fun `classifies definite local network destinations without blocking public HTTPS DNS`() {
    assertTrue(valid("http", "desktop.example.com", 7437).requiresLocalNetworkPermission())
    assertTrue(valid("https", "10.1.2.3", 443).requiresLocalNetworkPermission())
    assertTrue(valid("https", "100.64.0.1", 443).requiresLocalNetworkPermission())
    assertTrue(valid("https", "169.254.10.8", 443).requiresLocalNetworkPermission())
    assertTrue(valid("https", "fd00::8", 443).requiresLocalNetworkPermission())
    assertTrue(valid("https", "host.local", 443).requiresLocalNetworkPermission())
    assertFalse(valid("https", "remote.example.com", 443).requiresLocalNetworkPermission())
    assertFalse(valid("https", "203.0.113.10", 443).requiresLocalNetworkPermission())
  }

  @Test
  fun `fragment bootstrap percent encodes token without query leakage`() {
    val url = valid("https", "desktop.example.com", 8443).remoteControlUrl("a+b/c==")
    assertEquals("https://desktop.example.com:8443/rc#token=a%2Bb%2Fc%3D%3D", url)
    assertFalse(url.substringBefore('#').contains("token"))
  }

  private fun valid(scheme: String, host: String, port: Int): ConnectionEndpoint {
    val result = ConnectionEndpoint.validate(scheme, host, port)
    assertTrue(result is EndpointValidation.Valid)
    return (result as EndpointValidation.Valid).endpoint
  }

  private fun assertInvalid(scheme: String, host: String, port: Int?, field: EndpointField) {
    val result = ConnectionEndpoint.validate(scheme, host, port)
    assertTrue(result is EndpointValidation.Invalid)
    assertEquals(field, (result as EndpointValidation.Invalid).field)
  }
}
