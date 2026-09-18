package com.aetherci.sorcerer.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OriginPolicyTest {
  private val endpoint = (ConnectionEndpoint.validate(
    "https",
    "Desktop.Example.com",
    8443,
  ) as EndpointValidation.Valid).endpoint
  private val policy = OriginPolicy(endpoint)

  @Test
  fun `allows only the exact configured origin`() {
    assertTrue(policy.allows("https://desktop.example.com:8443/rc"))
    assertTrue(policy.allows("https://DESKTOP.EXAMPLE.COM:8443/rc-assets/xterm.js"))
    assertFalse(policy.allows("http://desktop.example.com:8443/rc"))
    assertFalse(policy.allows("https://desktop.example.com/rc"))
    assertFalse(policy.allows("https://desktop.example.com:8444/rc"))
    assertFalse(policy.allows("https://desktop.example.com:8443@evil.example/rc"))
    assertFalse(policy.allows("file:///data/local/tmp/payload"))
  }

  @Test
  fun `removes fragments before opening an external link`() {
    val external = policy.sanitizedExternalUri("https://docs.example.com/help?q=remote#token=secret")
    assertEquals("https://docs.example.com/help?q=remote", external?.toASCIIString())
    assertNull(policy.sanitizedExternalUri("intent://evil.example/#Intent;scheme=https;end"))
    assertNull(policy.sanitizedExternalUri("https://user:password@docs.example.com/help"))
  }
}
