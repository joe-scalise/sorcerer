package com.aetherci.sorcerer.remote

import java.net.IDN
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets
import java.util.Locale

class ConnectionEndpoint private constructor(
  val scheme: String,
  val host: String,
  val port: Int,
) {
  val authority: String
    get() = if (host.contains(':')) "[$host]:$port" else "$host:$port"

  val origin: String
    get() = "$scheme://$authority"

  fun remoteControlUrl(token: String): String =
    "$origin/rc#token=${UrlEncoding.encodeComponent(token)}"

  // HTTP is supported only for the LAN/VPN threat model. Ordinary HTTPS DNS
  // names are resolved on the pairing worker before this decision is finalized.
  fun requiresLocalNetworkPermission(): Boolean = scheme == "http" || HostParser.isLocal(host)

  override fun equals(other: Any?): Boolean =
    other is ConnectionEndpoint && scheme == other.scheme && host == other.host && port == other.port

  override fun hashCode(): Int = 31 * (31 * scheme.hashCode() + host.hashCode()) + port

  override fun toString(): String = origin

  companion object {
    fun validate(schemeInput: String, hostInput: String, portInput: Int?): EndpointValidation {
      val scheme = schemeInput.trim().lowercase(Locale.US)
      if (scheme != "http" && scheme != "https") {
        return EndpointValidation.Invalid(EndpointField.SCHEME, "Use http or https")
      }

      if (portInput == null || portInput !in 1..65535) {
        return EndpointValidation.Invalid(EndpointField.PORT, "Port must be between 1 and 65535")
      }

      return when (val parsedHost = HostParser.parse(hostInput)) {
        is HostParseResult.Invalid -> EndpointValidation.Invalid(EndpointField.HOST, parsedHost.reason)
        is HostParseResult.Valid -> EndpointValidation.Valid(
          ConnectionEndpoint(scheme, parsedHost.normalized, portInput),
        )
      }
    }
  }
}

enum class EndpointField {
  SCHEME,
  HOST,
  PORT,
}

sealed interface EndpointValidation {
  data class Valid(val endpoint: ConnectionEndpoint) : EndpointValidation
  data class Invalid(val field: EndpointField, val reason: String) : EndpointValidation
}

internal sealed interface HostParseResult {
  data class Valid(val normalized: String, val address: ByteArray?) : HostParseResult
  data class Invalid(val reason: String) : HostParseResult
}

internal object HostParser {
  private val ipv4Shape = Regex("^[0-9.]+$")
  private val dnsLabel = Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

  fun parse(input: String): HostParseResult {
    var candidate = input.trim()
    if (candidate.startsWith('[') || candidate.endsWith(']')) {
      if (!(candidate.startsWith('[') && candidate.endsWith(']'))) {
        return HostParseResult.Invalid("IPv6 brackets are incomplete")
      }
      candidate = candidate.substring(1, candidate.length - 1)
    }

    if (candidate.isBlank()) return HostParseResult.Invalid("Host is required")
    if (candidate.length > 253) return HostParseResult.Invalid("Host is too long")
    if (candidate.any { it.isWhitespace() } || candidate.any { it in "/?#@" }) {
      return HostParseResult.Invalid("Enter a host name or address, not a URL")
    }

    return when {
      candidate.contains(':') -> parseIpv6(candidate)
      ipv4Shape.matches(candidate) -> parseIpv4(candidate)
      else -> parseDns(candidate)
    }
  }

  fun isLocal(host: String): Boolean {
    return when (val parsed = parse(host)) {
      is HostParseResult.Invalid -> false
      is HostParseResult.Valid -> {
        val bytes = parsed.address
        when {
          bytes == null -> {
            val dns = parsed.normalized
            !dns.contains('.') ||
              dns.endsWith(".local") ||
              dns.endsWith(".lan") ||
              dns.endsWith(".internal") ||
              dns.endsWith(".home.arpa")
          }
          else -> isLocalAddress(bytes)
        }
      }
    }
  }

  fun isDnsName(host: String): Boolean = when (val parsed = parse(host)) {
    is HostParseResult.Invalid -> false
    is HostParseResult.Valid -> parsed.address == null
  }

  fun isLocalAddress(bytes: ByteArray): Boolean {
    val first = bytes.firstOrNull()?.toInt()?.and(0xff) ?: return false
    val second = bytes.getOrNull(1)?.toInt()?.and(0xff) ?: return false
    return when (bytes.size) {
      4 -> first == 10 ||
        (first == 100 && second in 64..127) ||
        (first == 169 && second == 254) ||
        (first == 172 && second in 16..31) ||
        (first == 192 && second == 168)
      16 -> (first and 0xfe) == 0xfc || (first == 0xfe && (second and 0xc0) == 0x80)
      else -> false
    }
  }

  private fun parseIpv4(candidate: String): HostParseResult {
    val pieces = candidate.split('.')
    if (pieces.size != 4 || pieces.any { it.isEmpty() || it.length > 3 }) {
      return HostParseResult.Invalid("IPv4 addresses must contain four octets")
    }
    val octets = pieces.map { it.toIntOrNull() }
    if (octets.any { it == null || it !in 0..255 }) {
      return HostParseResult.Invalid("IPv4 octets must be between 0 and 255")
    }
    val values = octets.filterNotNull()
    if (values[0] == 0 || values[0] == 127 || values[0] >= 224 || values.all { it == 255 }) {
      return HostParseResult.Invalid("Use an address reachable from this phone")
    }
    return HostParseResult.Valid(
      values.joinToString("."),
      values.map(Int::toByte).toByteArray(),
    )
  }

  private fun parseIpv6(candidate: String): HostParseResult {
    if (candidate.contains('%')) {
      return HostParseResult.Invalid("Scoped IPv6 addresses are not supported")
    }
    val address = try {
      InetAddress.getByName(candidate)
    } catch (_: UnknownHostException) {
      return HostParseResult.Invalid("IPv6 address is invalid")
    }
    if (address !is Inet6Address) return HostParseResult.Invalid("IPv6 address is invalid")
    if (address.isAnyLocalAddress ||
      address.isLoopbackAddress ||
      address.isMulticastAddress ||
      address.isLinkLocalAddress
    ) {
      return HostParseResult.Invalid("Use an address reachable from this phone")
    }
    val normalized = address.hostAddress?.lowercase(Locale.US)
      ?: return HostParseResult.Invalid("IPv6 address is invalid")
    return HostParseResult.Valid(normalized, address.address)
  }

  private fun parseDns(candidate: String): HostParseResult {
    val withoutTrailingDot = candidate.removeSuffix(".")
    val ascii = try {
      IDN.toASCII(withoutTrailingDot, IDN.USE_STD3_ASCII_RULES).lowercase(Locale.US)
    } catch (_: IllegalArgumentException) {
      return HostParseResult.Invalid("Host name is invalid")
    }
    if (ascii == "localhost") return HostParseResult.Invalid("localhost points to the phone, not the desktop")
    if (ascii.isBlank() || ascii.length > 253 || ascii.split('.').any { !dnsLabel.matches(it) }) {
      return HostParseResult.Invalid("Host name is invalid")
    }
    return HostParseResult.Valid(ascii, null)
  }
}

internal object UrlEncoding {
  private val unreserved = ("abcdefghijklmnopqrstuvwxyz" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "0123456789-._~").toSet()

  fun encodeComponent(value: String): String {
    val output = StringBuilder()
    value.toByteArray(StandardCharsets.UTF_8).forEach { byte ->
      val unsigned = byte.toInt() and 0xff
      val character = unsigned.toChar()
      if (character in unreserved) {
        output.append(character)
      } else {
        output.append('%')
        output.append(HEX[unsigned ushr 4])
        output.append(HEX[unsigned and 0x0f])
      }
    }
    return output.toString()
  }

  private const val HEX = "0123456789ABCDEF"
}
