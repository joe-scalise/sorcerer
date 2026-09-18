package com.aetherci.sorcerer.remote

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureConnectionStoreTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
  private val store = SecureConnectionStore(context)

  @Before
  fun setUp() {
    store.clear()
  }

  @After
  fun tearDown() {
    store.clear()
  }

  @Test
  fun encryptedConnectionSurvivesStoreRecreation() {
    val endpoint = (ConnectionEndpoint.validate(
      "https",
      "desktop.example.com",
      443,
    ) as EndpointValidation.Valid).endpoint
    val record = ConnectionRecord(endpoint, "instrumentation-device-token")
    store.save(record)

    assertEquals(record, SecureConnectionStore(context).load())
  }
}
