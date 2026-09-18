package com.aetherci.sorcerer.remote

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

data class ConnectionRecord(
  val endpoint: ConnectionEndpoint,
  val token: String,
  val requiresLocalNetworkAccess: Boolean = endpoint.requiresLocalNetworkPermission(),
)

object ConnectionRecordCodec {
  private const val FORMAT_VERSION = 1
  private const val MAX_TOKEN_LENGTH = 2048

  fun encode(record: ConnectionRecord): ByteArray {
    require(record.token.isNotBlank() && record.token.length <= MAX_TOKEN_LENGTH) { "Token is invalid" }
    return ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        output.writeInt(FORMAT_VERSION)
        output.writeUTF(record.endpoint.scheme)
        output.writeUTF(record.endpoint.host)
        output.writeInt(record.endpoint.port)
        output.writeBoolean(record.requiresLocalNetworkAccess)
        output.writeUTF(record.token)
      }
      bytes.toByteArray()
    }
  }

  fun decode(bytes: ByteArray): ConnectionRecord? = try {
    DataInputStream(ByteArrayInputStream(bytes)).use { input ->
      if (input.readInt() != FORMAT_VERSION) return null
      val scheme = input.readUTF()
      val host = input.readUTF()
      val port = input.readInt()
      val requiresLocalNetworkAccess = input.readBoolean()
      val token = input.readUTF()
      if (input.available() != 0 || token.isBlank() || token.length > MAX_TOKEN_LENGTH) return null
      val endpoint = when (val validation = ConnectionEndpoint.validate(scheme, host, port)) {
        is EndpointValidation.Invalid -> return null
        is EndpointValidation.Valid -> validation.endpoint
      }
      ConnectionRecord(
        endpoint,
        token,
        requiresLocalNetworkAccess || endpoint.requiresLocalNetworkPermission(),
      )
    }
  } catch (_: Exception) {
    null
  }
}
