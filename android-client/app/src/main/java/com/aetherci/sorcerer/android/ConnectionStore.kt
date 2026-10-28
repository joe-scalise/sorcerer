package com.aetherci.sorcerer.android

import android.content.Context

class ConnectionStore(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun load(): ConnectionConfig? {
    val scheme = prefs.getString(KEY_SCHEME, DEFAULT_SCHEME)?.trim().orEmpty()
    val host = prefs.getString(KEY_HOST, "")?.trim().orEmpty()
    val port = prefs.getInt(KEY_PORT, DEFAULT_PORT)
    val token = prefs.getString(KEY_TOKEN, "")?.trim().orEmpty()
    if (host.isBlank() || token.isBlank() || port !in 1..65535) return null
    return ConnectionConfig(scheme = scheme.ifBlank { DEFAULT_SCHEME }, host = host, port = port, token = token)
  }

  fun save(config: ConnectionConfig) {
    prefs.edit()
      .putString(KEY_SCHEME, config.scheme)
      .putString(KEY_HOST, config.host)
      .putInt(KEY_PORT, config.port)
      .putString(KEY_TOKEN, config.token)
      .apply()
  }

  companion object {
    private const val PREFS_NAME = "sorcerer_remote"
    private const val KEY_SCHEME = "scheme"
    private const val KEY_HOST = "host"
    private const val KEY_PORT = "port"
    private const val KEY_TOKEN = "token"

    const val DEFAULT_SCHEME = "http"
    const val DEFAULT_PORT = 7437
  }
}
