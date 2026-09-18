package com.aetherci.sorcerer.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionRecordCodecTest {
  @Test
  fun `persists endpoint and token without loss`() {
    val endpoint = (ConnectionEndpoint.validate(
      "https",
      "desktop.local",
      7437,
    ) as EndpointValidation.Valid).endpoint
    val original = ConnectionRecord(
      endpoint,
      "device_token-with_symbols.123",
      requiresLocalNetworkAccess = true,
    )

    assertEquals(original, ConnectionRecordCodec.decode(ConnectionRecordCodec.encode(original)))
  }

  @Test
  fun `rejects corrupted and trailing data`() {
    assertNull(ConnectionRecordCodec.decode(byteArrayOf(1, 2, 3)))

    val endpoint = (ConnectionEndpoint.validate("http", "10.0.0.2", 7437) as EndpointValidation.Valid).endpoint
    val encoded = ConnectionRecordCodec.encode(ConnectionRecord(endpoint, "valid-device-token"))
    assertNull(ConnectionRecordCodec.decode(encoded + byteArrayOf(1)))
  }

  @Test
  fun `rejects blank tokens before persistence`() {
    val endpoint = (ConnectionEndpoint.validate("http", "10.0.0.2", 7437) as EndpointValidation.Valid).endpoint
    val failure = runCatching { ConnectionRecordCodec.encode(ConnectionRecord(endpoint, "")) }
    assertTrue(failure.isFailure)
  }
}
