package com.aetherci.sorcerer.android

import android.net.Uri

data class ConnectionConfig(
  val scheme: String,
  val host: String,
  val port: Int,
  val token: String
) {
  fun remoteControlUrl(): String {
    val base = Uri.Builder()
      .scheme(scheme)
      .encodedAuthority("$host:$port")
      .appendPath("rc")
      .appendQueryParameter("token", token)
      .build()
    return base.toString()
  }
}
