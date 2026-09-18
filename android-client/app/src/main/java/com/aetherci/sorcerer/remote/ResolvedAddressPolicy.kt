package com.aetherci.sorcerer.remote

import java.net.Inet6Address
import java.net.InetAddress

internal sealed interface ResolvedAddressClassification {
  data class Usable(val requiresLocalNetworkAccess: Boolean) : ResolvedAddressClassification
  data object Unusable : ResolvedAddressClassification
}

internal object ResolvedAddressPolicy {
  fun classify(addresses: Array<InetAddress>): ResolvedAddressClassification {
    if (addresses.isEmpty() || addresses.any(::isUnusable)) {
      return ResolvedAddressClassification.Unusable
    }
    return ResolvedAddressClassification.Usable(
      addresses.any { HostParser.isLocalAddress(it.address) },
    )
  }

  private fun isUnusable(address: InetAddress): Boolean =
    address.isAnyLocalAddress ||
      address.isLoopbackAddress ||
      address.isMulticastAddress ||
      (address is Inet6Address && address.isLinkLocalAddress)
}
