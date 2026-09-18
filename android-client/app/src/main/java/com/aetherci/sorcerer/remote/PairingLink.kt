package com.aetherci.sorcerer.remote

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale

data class PairingRequest(
  val endpoint: ConnectionEndpoint,
  val code: String,
  val protocolVersion: Int,
)

sealed interface PairingLinkResult {
  data class Valid(val request: PairingRequest) : PairingLinkResult
  data class Invalid(val reason: String) : PairingLinkResult
}

object PairingLink {
  const val URI_SCHEME = "sorcerer-remote"
  const val URI_HOST = "pair"
  const val PROTOCOL_VERSION = 1

  private val allowedKeys = setOf("scheme", "host", "port", "code", "v")
  private val codePattern = Regex("^[A-Za-z0-9_-]{6,128}$")

  fun parse(value: String): PairingLinkResult {
    val uri = try {
      URI(value)
    } catch (_: Exception) {
      return PairingLinkResult.Invalid("Pairing link is malformed")
    }

    if (!uri.scheme.equals(URI_SCHEME, ignoreCase = true) ||
      !uri.host.equals(URI_HOST, ignoreCase = true) ||
      (uri.path.isNotEmpty() && uri.path != "/") ||
      uri.rawUserInfo != null ||
      uri.port != -1 ||
      uri.rawFragment != null
    ) {
      return PairingLinkResult.Invalid("This is not a Sorcerer Remote pairing link")
    }

    val parameters = parseQuery(uri.rawQuery ?: return PairingLinkResult.Invalid("Pairing data is missing"))
      ?: return PairingLinkResult.Invalid("Pairing data is malformed")
    if (parameters.keys != allowedKeys) {
      return PairingLinkResult.Invalid("Pairing link fields are missing or unsupported")
    }

    val version = parameters.getValue("v").toIntOrNull()
    if (version != PROTOCOL_VERSION) {
      return PairingLinkResult.Invalid("The desktop uses an incompatible pairing protocol")
    }

    val code = parameters.getValue("code").trim()
    if (!codePattern.matches(code)) {
      return PairingLinkResult.Invalid("Pairing code is invalid")
    }

    val port = parameters.getValue("port").toIntOrNull()
    return when (val endpoint = ConnectionEndpoint.validate(
      parameters.getValue("scheme").lowercase(Locale.US),
      parameters.getValue("host"),
      port,
    )) {
      is EndpointValidation.Invalid -> PairingLinkResult.Invalid(endpoint.reason)
      is EndpointValidation.Valid -> PairingLinkResult.Valid(
        PairingRequest(endpoint.endpoint, code, version),
      )
    }
  }

  private fun parseQuery(rawQuery: String): Map<String, String>? {
    if (rawQuery.isBlank()) return null
    val values = linkedMapOf<String, String>()
    for (item in rawQuery.split('&')) {
      val separator = item.indexOf('=')
      if (separator <= 0) return null
      val key = decode(item.substring(0, separator)) ?: return null
      val value = decode(item.substring(separator + 1)) ?: return null
      if (key in values) return null
      values[key] = value
    }
    return values
  }

  private fun decode(value: String): String? = try {
    URLDecoder.decode(value, StandardCharsets.UTF_8.name())
  } catch (_: IllegalArgumentException) {
    null
  }
}
