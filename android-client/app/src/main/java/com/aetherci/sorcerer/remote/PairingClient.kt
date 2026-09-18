package com.aetherci.sorcerer.remote

import android.os.Handler
import android.os.Looper
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import javax.net.ssl.SSLException

sealed interface PairingResult {
  data class Success(
    val token: String,
    val protocolVersion: Int,
    val capabilities: List<String>,
    val requiresLocalNetworkAccess: Boolean,
  ) : PairingResult

  data object LocalNetworkPermissionRequired : PairingResult

  data class Failure(val kind: PairingFailureKind, val message: String) : PairingResult
}

enum class PairingFailureKind {
  CODE_REJECTED,
  INCOMPATIBLE,
  TLS,
  UNREACHABLE,
  SERVER,
  INVALID_RESPONSE,
}

class PairingClient(
  private val executor: ExecutorService = Executors.newSingleThreadExecutor(),
  private val mainHandler: Handler = Handler(Looper.getMainLooper()),
) : AutoCloseable {
  fun pair(
    request: PairingRequest,
    deviceName: String,
    hasLocalNetworkPermission: Boolean,
    callback: (PairingResult) -> Unit,
  ): Future<*> = executor.submit {
    val result = performPairing(request, deviceName, hasLocalNetworkPermission)
    mainHandler.post { callback(result) }
  }

  private fun performPairing(
    request: PairingRequest,
    deviceName: String,
    hasLocalNetworkPermission: Boolean,
  ): PairingResult {
    val requiresLocalNetworkAccess = when (val resolution = resolveNetworkRequirement(request.endpoint)) {
      is NetworkRequirement.Failed -> return resolution.result
      is NetworkRequirement.Resolved -> resolution.required
    }
    if (requiresLocalNetworkAccess && !hasLocalNetworkPermission) {
      return PairingResult.LocalNetworkPermissionRequired
    }

    val url = URL("${request.endpoint.origin}/api/mobile/v1/pair")
    val connection = try {
      url.openConnection() as HttpURLConnection
    } catch (_: IOException) {
      return PairingResult.Failure(PairingFailureKind.UNREACHABLE, "Could not open the desktop connection")
    }

    return try {
      connection.apply {
        requestMethod = "POST"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        instanceFollowRedirects = false
        useCaches = false
        doOutput = true
        setRequestProperty("Accept", "application/json")
        setRequestProperty("Cache-Control", "no-store")
        setRequestProperty("Content-Type", "application/json; charset=utf-8")
      }
      val payload = JSONObject()
        .put("code", request.code)
        .put("deviceName", deviceName.take(MAX_DEVICE_NAME_LENGTH))
        .toString()
        .toByteArray(StandardCharsets.UTF_8)
      connection.setFixedLengthStreamingMode(payload.size)
      connection.outputStream.use { it.write(payload) }

      val status = connection.responseCode
      if (status != HttpURLConnection.HTTP_OK) return mapHttpFailure(status)
      parseSuccess(readLimited(connection.inputStream), requiresLocalNetworkAccess)
    } catch (_: SocketTimeoutException) {
      PairingResult.Failure(PairingFailureKind.UNREACHABLE, "The desktop did not respond in time")
    } catch (_: SSLException) {
      PairingResult.Failure(PairingFailureKind.TLS, "The desktop certificate is not trusted")
    } catch (_: IOException) {
      PairingResult.Failure(PairingFailureKind.UNREACHABLE, "The desktop is unreachable")
    } catch (_: JSONException) {
      PairingResult.Failure(PairingFailureKind.INVALID_RESPONSE, "The desktop returned an invalid response")
    } finally {
      connection.disconnect()
    }
  }

  private fun resolveNetworkRequirement(endpoint: ConnectionEndpoint): NetworkRequirement {
    if (endpoint.requiresLocalNetworkPermission()) return NetworkRequirement.Resolved(true)
    if (!HostParser.isDnsName(endpoint.host)) return NetworkRequirement.Resolved(false)

    val addresses = try {
      InetAddress.getAllByName(endpoint.host)
    } catch (_: UnknownHostException) {
      return NetworkRequirement.Failed(
        PairingResult.Failure(PairingFailureKind.UNREACHABLE, "The desktop host name could not be resolved"),
      )
    }
    return when (val classification = ResolvedAddressPolicy.classify(addresses)) {
      ResolvedAddressClassification.Unusable -> NetworkRequirement.Failed(
        PairingResult.Failure(PairingFailureKind.UNREACHABLE, "The desktop host name resolved to an unusable address"),
      )
      is ResolvedAddressClassification.Usable -> {
        NetworkRequirement.Resolved(classification.requiresLocalNetworkAccess)
      }
    }
  }

  private fun parseSuccess(body: ByteArray, requiresLocalNetworkAccess: Boolean): PairingResult {
    val json = JSONObject(String(body, StandardCharsets.UTF_8))
    val protocolVersion = json.optInt("protocolVersion", -1)
    if (protocolVersion != PairingLink.PROTOCOL_VERSION) {
      return PairingResult.Failure(
        PairingFailureKind.INCOMPATIBLE,
        "The desktop uses an incompatible mobile protocol",
      )
    }
    val token = json.optString("token")
    if (token.isBlank() || token.length > MAX_TOKEN_LENGTH || token.any(Char::isWhitespace)) {
      return PairingResult.Failure(PairingFailureKind.INVALID_RESPONSE, "The desktop returned an invalid token")
    }
    val capabilitiesJson = json.optJSONArray("capabilities")
      ?: return PairingResult.Failure(PairingFailureKind.INVALID_RESPONSE, "Capabilities are missing")
    val capabilities = buildList {
      for (index in 0 until capabilitiesJson.length()) {
        val capability = capabilitiesJson.optString(index)
        if (capability.isBlank()) {
          return PairingResult.Failure(PairingFailureKind.INVALID_RESPONSE, "Capabilities are invalid")
        }
        add(capability)
      }
    }
    return PairingResult.Success(token, protocolVersion, capabilities, requiresLocalNetworkAccess)
  }

  private fun mapHttpFailure(status: Int): PairingResult.Failure = when (status) {
    HttpURLConnection.HTTP_BAD_REQUEST,
    HttpURLConnection.HTTP_NOT_FOUND,
    HttpURLConnection.HTTP_GONE,
    -> PairingResult.Failure(
      PairingFailureKind.CODE_REJECTED,
      "The pairing code is invalid, expired, or already used",
    )
    HttpURLConnection.HTTP_UNAUTHORIZED,
    HttpURLConnection.HTTP_FORBIDDEN,
    -> PairingResult.Failure(PairingFailureKind.CODE_REJECTED, "The desktop rejected the pairing request")
    426 -> PairingResult.Failure(
      PairingFailureKind.INCOMPATIBLE,
      "Update Sorcerer Remote or the desktop app before pairing",
    )
    in 500..599 -> PairingResult.Failure(PairingFailureKind.SERVER, "The desktop could not complete pairing")
    else -> PairingResult.Failure(PairingFailureKind.INVALID_RESPONSE, "Unexpected desktop response ($status)")
  }

  private fun readLimited(stream: java.io.InputStream): ByteArray = stream.use { input ->
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(4096)
    var total = 0
    while (true) {
      val count = input.read(buffer)
      if (count == -1) break
      total += count
      if (total > MAX_RESPONSE_BYTES) throw IOException("Pairing response is too large")
      output.write(buffer, 0, count)
    }
    output.toByteArray()
  }

  override fun close() {
    executor.shutdownNow()
  }

  private sealed interface NetworkRequirement {
    data class Resolved(val required: Boolean) : NetworkRequirement
    data class Failed(val result: PairingResult.Failure) : NetworkRequirement
  }

  companion object {
    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 12_000
    private const val MAX_RESPONSE_BYTES = 64 * 1024
    private const val MAX_TOKEN_LENGTH = 2048
    private const val MAX_DEVICE_NAME_LENGTH = 80
  }
}
