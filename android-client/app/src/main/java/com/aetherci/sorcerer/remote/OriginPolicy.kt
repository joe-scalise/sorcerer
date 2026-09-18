package com.aetherci.sorcerer.remote

import java.net.URI

class OriginPolicy(private val endpoint: ConnectionEndpoint) {
  fun allows(url: String): Boolean {
    val uri = try {
      URI(url)
    } catch (_: Exception) {
      return false
    }
    if (!uri.scheme.equals(endpoint.scheme, ignoreCase = true) || uri.rawUserInfo != null) return false

    val host = uri.host ?: return false
    val normalizedHost = when (val parsed = HostParser.parse(host)) {
      is HostParseResult.Invalid -> return false
      is HostParseResult.Valid -> parsed.normalized
    }
    if (normalizedHost != endpoint.host) return false

    val effectivePort = when {
      uri.port != -1 -> uri.port
      uri.scheme.equals("https", ignoreCase = true) -> 443
      else -> 80
    }
    return effectivePort == endpoint.port
  }

  fun sanitizedExternalUri(url: String): URI? {
    val uri = try {
      URI(url)
    } catch (_: Exception) {
      return null
    }
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (uri.host == null || uri.rawUserInfo != null) return null
    return URI(scheme, null, uri.host, uri.port, uri.path, uri.query, null)
  }
}
