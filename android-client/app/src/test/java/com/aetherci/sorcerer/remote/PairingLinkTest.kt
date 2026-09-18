package com.aetherci.sorcerer.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingLinkTest {
  @Test
  fun `parses a code-only pairing link`() {
    val result = PairingLink.parse(
      "sorcerer-remote://pair?scheme=http&host=192.168.1.8&port=7437&code=abcDEF_123&v=1",
    )
    assertTrue(result is PairingLinkResult.Valid)
    val request = (result as PairingLinkResult.Valid).request
    assertEquals("http://192.168.1.8:7437", request.endpoint.origin)
    assertEquals("abcDEF_123", request.code)
    assertEquals(1, request.protocolVersion)
  }

  @Test
  fun `parses percent encoded IPv6`() {
    val result = PairingLink.parse(
      "sorcerer-remote://pair?scheme=https&host=%5B2001%3Adb8%3A%3A8%5D&port=443&code=ABCDEF12&v=1",
    )
    assertTrue(result is PairingLinkResult.Valid)
    assertTrue((result as PairingLinkResult.Valid).request.endpoint.host.contains(':'))
  }

  @Test
  fun `rejects permanent tokens duplicate fields and incompatible versions`() {
    assertInvalid(
      "sorcerer-remote://pair?scheme=http&host=10.0.0.2&port=7437&code=ABCDEF12&v=1&token=secret",
    )
    assertInvalid(
      "sorcerer-remote://pair?scheme=http&host=10.0.0.2&port=7437&code=ABCDEF12&code=OTHER12&v=1",
    )
    assertInvalid(
      "sorcerer-remote://pair?scheme=http&host=10.0.0.2&port=7437&code=ABCDEF12&v=2",
    )
    assertInvalid(
      "sorcerer://pair?scheme=http&host=10.0.0.2&port=7437&code=ABCDEF12&v=1",
    )
  }

  @Test
  fun `accepts only the exact credential failure signal`() {
    assertEquals(
      NativeSignal.AUTH_FAILED,
      NativeSignalParser.parse("sorcerer-remote://auth-failed"),
    )
    assertEquals(null, NativeSignalParser.parse("sorcerer-remote://auth-failed/"))
    assertEquals(null, NativeSignalParser.parse("sorcerer-remote://auth-failed?token=secret"))
    assertEquals(null, NativeSignalParser.parse("sorcerer-remote://pair"))
    assertEquals(null, NativeSignalParser.parse("https://auth-failed"))
  }

  private fun assertInvalid(link: String) {
    assertTrue(PairingLink.parse(link) is PairingLinkResult.Invalid)
  }
}
