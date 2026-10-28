package com.aetherci.sorcerer.android

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.aetherci.sorcerer.android.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
  private lateinit var binding: ActivityMainBinding
  private lateinit var connectionStore: ConnectionStore
  private var needsInitialSetup = false

  private val settingsLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) {
    val config = connectionStore.load()
    if (config == null && needsInitialSetup) {
      finish()
      return@registerForActivityResult
    }
    loadConfiguredRemote()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    binding = ActivityMainBinding.inflate(layoutInflater)
    setContentView(binding.root)

    connectionStore = ConnectionStore(this)
    importConnectionFromIntent(intent)

    setSupportActionBar(binding.toolbar)
    configureWebView(binding.webView)
    loadConfiguredRemote()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (importConnectionFromIntent(intent)) {
      loadConfiguredRemote()
    }
  }

  override fun onCreateOptionsMenu(menu: Menu): Boolean {
    menuInflater.inflate(R.menu.main_actions, menu)
    return true
  }

  override fun onOptionsItemSelected(item: MenuItem): Boolean {
    return when (item.itemId) {
      R.id.action_reload -> {
        binding.webView.reload()
        true
      }
      R.id.action_open_in_browser -> {
        openInBrowser()
        true
      }
      R.id.action_settings -> {
        openSettings()
        true
      }
      else -> super.onOptionsItemSelected(item)
    }
  }

  override fun onBackPressed() {
    if (binding.webView.canGoBack()) {
      binding.webView.goBack()
    } else {
      super.onBackPressed()
    }
  }

  private fun configureWebView(webView: WebView) {
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      cacheMode = WebSettings.LOAD_DEFAULT
      mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = true
      useWideViewPort = true
    }

    webView.webChromeClient = WebChromeClient()
    webView.webViewClient = object : WebViewClient() {
      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        binding.loadingOverlay.visibility = View.VISIBLE
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        binding.loadingOverlay.visibility = View.GONE
      }

      override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
      ) {
        if (request?.isForMainFrame == true) {
          binding.loadingOverlay.visibility = View.GONE
          Toast.makeText(
            this@MainActivity,
            error?.description ?: getString(R.string.error_missing_config),
            Toast.LENGTH_LONG
          ).show()
        }
      }
    }
  }

  private fun loadConfiguredRemote() {
    val config = connectionStore.load()
    if (config == null) {
      needsInitialSetup = true
      openSettings()
      return
    }

    needsInitialSetup = false
    val targetUrl = config.remoteControlUrl()
    if (binding.webView.url != targetUrl) {
      binding.webView.loadUrl(targetUrl)
    }
  }

  private fun importConnectionFromIntent(intent: Intent?): Boolean {
    val data = intent?.data ?: return false
    if (data.scheme != "sorcerer-remote" || data.host != "connect") return false

    val scheme = data.getQueryParameter("scheme").orEmpty().ifBlank { ConnectionStore.DEFAULT_SCHEME }
    val host = data.getQueryParameter("host").orEmpty().trim()
    val token = data.getQueryParameter("token").orEmpty().trim()
    val port = data.getQueryParameter("port")?.toIntOrNull() ?: ConnectionStore.DEFAULT_PORT

    if (host.isBlank() || token.isBlank() || port !in 1..65535) {
      Toast.makeText(this, R.string.error_invalid_deeplink, Toast.LENGTH_LONG).show()
      return false
    }

    connectionStore.save(
      ConnectionConfig(
        scheme = if (scheme == "https") "https" else ConnectionStore.DEFAULT_SCHEME,
        host = host,
        port = port,
        token = token
      )
    )
    Toast.makeText(this, R.string.message_qr_imported, Toast.LENGTH_SHORT).show()
    return true
  }

  private fun openSettings() {
    settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
  }

  private fun openInBrowser() {
    val config = connectionStore.load() ?: run {
      Toast.makeText(this, R.string.error_missing_config, Toast.LENGTH_LONG).show()
      return
    }

    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(config.remoteControlUrl()))
    try {
      startActivity(intent)
    } catch (_: ActivityNotFoundException) {
      Toast.makeText(this, R.string.error_no_browser, Toast.LENGTH_LONG).show()
    }
  }
}
