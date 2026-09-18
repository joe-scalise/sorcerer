package com.aetherci.sorcerer.remote

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Test

class ResolvedAddressPolicyTest {
  @Test
  fun `public HTTPS DNS answers do not require local network access`() {
    assertEquals(
      ResolvedAddressClassification.Usable(false),
      classify("203.0.113.10", "2001:db8::10"),
    )
  }

  @Test
  fun `any private split-horizon answer requires local network access`() {
    assertEquals(
      ResolvedAddressClassification.Usable(true),
      classify("203.0.113.10", "10.0.0.8"),
    )
    assertEquals(ResolvedAddressClassification.Usable(true), classify("100.64.0.8"))
    assertEquals(ResolvedAddressClassification.Usable(true), classify("fd00::8"))
  }

  @Test
  fun `loopback multicast and unscoped IPv6 link-local answers are unusable`() {
    assertEquals(ResolvedAddressClassification.Unusable, classify("127.0.0.1"))
    assertEquals(ResolvedAddressClassification.Unusable, classify("224.0.0.1"))
    assertEquals(ResolvedAddressClassification.Unusable, classify("fe80::8"))
  }

  private fun classify(vararg addresses: String): ResolvedAddressClassification =
    ResolvedAddressPolicy.classify(addresses.map(InetAddress::getByName).toTypedArray())
}
