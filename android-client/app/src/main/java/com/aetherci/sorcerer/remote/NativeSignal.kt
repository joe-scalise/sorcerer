package com.aetherci.sorcerer.remote

import java.net.URI

enum class NativeSignal {
  AUTH_FAILED,
}

object NativeSignalParser {
  fun parse(value: String): NativeSignal? {
    val uri = try {
      URI(value)
    } catch (_: Exception) {
      return null
    }
    if (!uri.scheme.equals(PairingLink.URI_SCHEME, ignoreCase = true) ||
      uri.rawUserInfo != null ||
      uri.port != -1 ||
      uri.rawQuery != null ||
      uri.rawFragment != null ||
      !uri.rawPath.isNullOrEmpty()
    ) {
      return null
    }
    return when {
      uri.host.equals("auth-failed", ignoreCase = true) -> NativeSignal.AUTH_FAILED
      else -> null
    }
  }
}
