package com.aetherci.sorcerer.remote

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.edit

object LocalNetworkAccess {
  const val PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"
  private const val ENFORCED_API = 37
  private const val PREFERENCES = "sorcerer_remote_permissions"
  private const val KEY_REQUESTED = "local_network_requested"

  fun isRequired(endpoint: ConnectionEndpoint): Boolean =
    Build.VERSION.SDK_INT >= ENFORCED_API && endpoint.requiresLocalNetworkPermission()

  fun isRequired(record: ConnectionRecord): Boolean =
    Build.VERSION.SDK_INT >= ENFORCED_API && record.requiresLocalNetworkAccess

  fun isGranted(context: Context, endpoint: ConnectionEndpoint): Boolean =
    !isRequired(endpoint) || hasPermission(context)

  fun isGranted(context: Context, record: ConnectionRecord): Boolean =
    !isRequired(record) || hasPermission(context)

  fun hasPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < ENFORCED_API ||
      context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

  fun shouldOfferAfterNetworkFailure(context: Context, endpoint: ConnectionEndpoint): Boolean =
    Build.VERSION.SDK_INT >= ENFORCED_API &&
      HostParser.isDnsName(endpoint.host) &&
      !hasPermission(context)

  fun wasRequested(context: Context): Boolean =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(KEY_REQUESTED, false)

  fun markRequested(context: Context) {
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit {
      putBoolean(KEY_REQUESTED, true)
    }
  }

  fun canRequestAgain(activity: Activity): Boolean =
    !wasRequested(activity) || activity.shouldShowRequestPermissionRationale(PERMISSION)

  fun appSettingsIntent(context: Context): Intent = Intent(
    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
    Uri.fromParts("package", context.packageName, null),
  )
}
