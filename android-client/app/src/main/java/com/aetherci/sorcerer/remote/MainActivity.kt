package com.aetherci.sorcerer.remote

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.ClientCertRequest
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.core.net.toUri
import androidx.webkit.SafeBrowsingResponseCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import com.aetherci.sorcerer.remote.databinding.ActivityMainBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import java.io.ByteArrayInputStream

class MainActivity : AppCompatActivity() {
  private lateinit var binding: ActivityMainBinding
  private lateinit var connectionStore: SecureConnectionStore
  private var webView: WebView? = null
  private var originPolicy: OriginPolicy? = null
  private var stateKind = StateKind.NONE

  private val pairLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult(),
  ) {
    loadConfiguredRemote(force = true)
  }

  private val permissionLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) { granted ->
    if (granted) loadConfiguredRemote(force = true) else showPermissionState()
  }

  private val settingsLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult(),
  ) {
    loadConfiguredRemote(force = true)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    binding = ActivityMainBinding.inflate(layoutInflater)
    setContentView(binding.root)
    applyInsets()

    connectionStore = SecureConnectionStore(this)
    configureToolbar()
    configureBackNavigation()
    createWebView()

    binding.stateEditAction.setOnClickListener { openPairingEditor() }
    loadConfiguredRemote(force = true)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.getBooleanExtra(EXTRA_CONNECTION_UPDATED, false)) {
      intent.removeExtra(EXTRA_CONNECTION_UPDATED)
      loadConfiguredRemote(force = true)
    }
  }

  override fun onResume() {
    super.onResume()
    webView?.onResume()
    webView?.resumeTimers()
    val record = connectionStore.load() ?: return
    if (!LocalNetworkAccess.isGranted(this, record)) {
      webView?.stopLoading()
      showPermissionState()
    } else if (stateKind == StateKind.PERMISSION) {
      loadConfiguredRemote(force = true)
    }
  }

  override fun onPause() {
    webView?.onPause()
    webView?.pauseTimers()
    super.onPause()
  }

  override fun onDestroy() {
    destroyWebView()
    super.onDestroy()
  }

  private fun applyInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
      val safeInsets = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime(),
      )
      view.updatePadding(
        left = safeInsets.left,
        top = safeInsets.top,
        right = safeInsets.right,
        bottom = safeInsets.bottom,
      )
      insets
    }
  }

  private fun configureToolbar() {
    binding.toolbar.setOnMenuItemClickListener { item ->
      when (item.itemId) {
        R.id.action_retry -> {
          loadConfiguredRemote(force = true)
          true
        }
        R.id.action_edit -> {
          openPairingEditor()
          true
        }
        R.id.action_forget -> {
          confirmForgetDevice()
          true
        }
        else -> false
      }
    }
  }

  private fun configureBackNavigation() {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val view = webView
        val history = view?.copyBackForwardList()
        val previousUrl = history
          ?.takeIf { it.currentIndex > 0 }
          ?.getItemAtIndex(history.currentIndex - 1)
          ?.url
        if (view != null && previousUrl != null && originPolicy?.allows(previousUrl) == true) {
          view.goBack()
        } else {
          finish()
        }
      }
    })
  }

  @SuppressLint("SetJavaScriptEnabled")
  @Suppress("DEPRECATION")
  private fun createWebView(): Boolean {
    if (webView != null) return true
    val view = try {
      WebView(this)
    } catch (_: RuntimeException) {
      showState(
        StateKind.WEBVIEW,
        R.string.webview_title,
        R.string.webview_message,
        R.string.retry,
        primaryAction = {
          if (createWebView()) loadConfiguredRemote(force = true)
        },
      )
      return false
    }

    view.layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    view.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      allowFileAccessFromFileURLs = false
      allowUniversalAccessFromFileURLs = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      mediaPlaybackRequiresUserGesture = true
      builtInZoomControls = false
      displayZoomControls = false
      saveFormData = false
      cacheMode = WebSettings.LOAD_DEFAULT
      userAgentString = "$userAgentString SorcererRemote/${BuildConfig.VERSION_NAME}"
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
      WebSettingsCompat.setSafeBrowsingEnabled(view.settings, true)
    }
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

    CookieManager.getInstance().apply {
      setAcceptCookie(false)
      setAcceptThirdPartyCookies(view, false)
    }
    view.webChromeClient = HardenedChromeClient()
    view.webViewClient = HardenedWebViewClient()
    view.setDownloadListener { _, _, _, _, _ ->
      Toast.makeText(this, R.string.download_blocked, Toast.LENGTH_SHORT).show()
    }
    binding.webContainer.addView(view)
    webView = view
    return true
  }

  private fun destroyWebView() {
    webView?.let { view ->
      binding.webContainer.removeView(view)
      view.stopLoading()
      view.webChromeClient = null
      view.webViewClient = WebViewClient()
      view.removeAllViews()
      view.destroy()
    }
    webView = null
  }

  private fun loadConfiguredRemote(force: Boolean) {
    val record = connectionStore.load()
    if (record == null) {
      originPolicy = null
      showState(
        StateKind.MISSING,
        R.string.connection_required_title,
        R.string.connection_required_message,
        R.string.connect_action,
        primaryAction = ::openPairingEditor,
        showEdit = false,
      )
      return
    }

    binding.toolbar.subtitle = record.endpoint.origin
    originPolicy = OriginPolicy(record.endpoint)
    if (!LocalNetworkAccess.isGranted(this, record)) {
      showPermissionState()
      return
    }
    if (!createWebView()) return

    val view = webView ?: return
    val currentUrl = view.url
    if (!force && currentUrl != null && originPolicy?.allows(currentUrl) == true && stateKind == StateKind.NONE) {
      return
    }
    stateKind = StateKind.NONE
    binding.stateCard.visibility = View.GONE
    binding.loadingIndicator.visibility = View.VISIBLE
    view.visibility = View.VISIBLE
    // Re-issue the fragment bootstrap after process/activity recreation because
    // the page deliberately keeps the token only in JavaScript memory.
    view.loadUrl(record.endpoint.remoteControlUrl(record.token))
  }

  private fun showPermissionState() {
    val record = connectionStore.load()
    val canRequest = LocalNetworkAccess.canRequestAgain(this)
    if (webView?.url != null) destroyWebView()
    showState(
      StateKind.PERMISSION,
      R.string.permission_title,
      R.string.permission_message,
      if (canRequest) R.string.grant_access else R.string.open_settings,
      primaryAction = {
        if (record == null) {
          openPairingEditor()
        } else if (LocalNetworkAccess.canRequestAgain(this)) {
          LocalNetworkAccess.markRequested(this)
          permissionLauncher.launch(LocalNetworkAccess.PERMISSION)
        } else {
          settingsLauncher.launch(LocalNetworkAccess.appSettingsIntent(this))
        }
      },
    )
  }

  private fun showState(
    kind: StateKind,
    title: Int,
    message: Int,
    primaryLabel: Int,
    primaryAction: () -> Unit,
    showEdit: Boolean = true,
  ) {
    stateKind = kind
    binding.loadingIndicator.visibility = View.GONE
    webView?.visibility = View.GONE
    binding.stateTitle.setText(title)
    binding.stateMessage.setText(message)
    binding.statePrimaryAction.setText(primaryLabel)
    binding.statePrimaryAction.setOnClickListener { primaryAction() }
    binding.stateEditAction.visibility = if (showEdit) View.VISIBLE else View.GONE
    binding.stateCard.visibility = View.VISIBLE
  }

  private fun showConnectionError(kind: StateKind, title: Int, message: Int) {
    if (kind != StateKind.PERMISSION) {
      val record = connectionStore.load()
      if (record != null && !LocalNetworkAccess.isGranted(this, record)) {
        showPermissionState()
        return
      }
    }
    showState(
      kind,
      title,
      message,
      R.string.retry,
      primaryAction = { loadConfiguredRemote(force = true) },
    )
  }

  private fun openPairingEditor() {
    pairLauncher.launch(Intent(this, PairActivity::class.java))
  }

  private fun confirmForgetDevice() {
    if (connectionStore.load() == null) return
    MaterialAlertDialogBuilder(this)
      .setTitle(R.string.forget_confirmation_title)
      .setMessage(R.string.forget_confirmation_message)
      .setNegativeButton(R.string.cancel, null)
      .setPositiveButton(R.string.forget_action) { _, _ -> forgetDevice() }
      .show()
  }

  private fun forgetDevice() {
    connectionStore.clear()
    originPolicy = null
    destroyWebView()
    CookieManager.getInstance().removeAllCookies(null)
    CookieManager.getInstance().flush()
    WebStorage.getInstance().deleteAllData()
    createWebView()
    loadConfiguredRemote(force = true)
  }

  private fun openExternal(url: String): Boolean {
    val uri = originPolicy?.sanitizedExternalUri(url) ?: return false
    return try {
      startActivity(Intent(Intent.ACTION_VIEW, uri.toASCIIString().toUri()))
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }

  private fun showAuthenticationFailure() {
    binding.root.post {
      if (isFinishing || isDestroyed) return@post
      // Stop the revoked page's WebSocket reconnect loop and erase its
      // in-memory token before presenting the recovery action.
      destroyWebView()
      showState(
        StateKind.AUTH,
        R.string.auth_title,
        R.string.auth_message,
        R.string.pair_again,
        primaryAction = ::openPairingEditor,
        showEdit = false,
      )
    }
  }

  private inner class HardenedWebViewClient : WebViewClientCompat() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val url = request.url.toString()
      if (NativeSignalParser.parse(url) == NativeSignal.AUTH_FAILED) {
        showAuthenticationFailure()
        return true
      }
      if (originPolicy?.allows(url) == true) return false
      if (request.isForMainFrame && request.hasGesture() && openExternal(url)) return true
      if (request.isForMainFrame) {
        Toast.makeText(this@MainActivity, R.string.external_link_blocked, Toast.LENGTH_SHORT).show()
      }
      return true
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
      val scheme = request.url.scheme?.lowercase()
      if (scheme == "http" || scheme == "https") {
        if (originPolicy?.allows(request.url.toString()) != true) return blockedResponse()
      } else if (scheme !in setOf("about", "data", "blob")) {
        return blockedResponse()
      }
      return null
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
      if (originPolicy?.allows(url) == true) {
        binding.stateCard.visibility = View.GONE
        binding.loadingIndicator.visibility = View.VISIBLE
        view.visibility = View.VISIBLE
      }
    }

    override fun onPageFinished(view: WebView, url: String) {
      if (originPolicy?.allows(url) == true) {
        stateKind = StateKind.NONE
        binding.loadingIndicator.visibility = View.GONE
        binding.stateCard.visibility = View.GONE
        view.visibility = View.VISIBLE
        // The page uses history.replaceState to remove the token fragment. Drop
        // bootstrap history so Back can never reveal a credential URL.
        view.clearHistory()
      }
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
      if (!request.isForMainFrame) return
      val record = connectionStore.load()
      if (record != null && !LocalNetworkAccess.isGranted(this@MainActivity, record)) {
        showPermissionState()
        return
      }
      val errorCode = if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_RESOURCE_ERROR_GET_CODE)) {
        error.errorCode
      } else {
        ERROR_UNKNOWN
      }
      if (record != null &&
        errorCode in setOf(ERROR_CONNECT, ERROR_TIMEOUT) &&
        LocalNetworkAccess.shouldOfferAfterNetworkFailure(this@MainActivity, record.endpoint)
      ) {
        showPermissionState()
        return
      }
      when (errorCode) {
        ERROR_AUTHENTICATION,
        ERROR_PROXY_AUTHENTICATION,
        -> showAuthenticationFailure()
        else -> showConnectionError(
          StateKind.UNREACHABLE,
          R.string.unreachable_title,
          R.string.unreachable_message,
        )
      }
    }

    override fun onReceivedHttpError(
      view: WebView,
      request: WebResourceRequest,
      errorResponse: WebResourceResponse,
    ) {
      if (!request.isForMainFrame) return
      when (errorResponse.statusCode) {
        401, 403 -> showAuthenticationFailure()
        426 -> showConnectionError(
          StateKind.INCOMPATIBLE,
          R.string.incompatible_title,
          R.string.incompatible_message,
        )
        else -> if (errorResponse.statusCode >= 400) {
          showConnectionError(StateKind.UNREACHABLE, R.string.unreachable_title, R.string.unreachable_message)
        }
      }
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
      handler.cancel()
      showConnectionError(StateKind.TLS, R.string.tls_title, R.string.tls_message)
    }

    override fun onReceivedHttpAuthRequest(
      view: WebView,
      handler: HttpAuthHandler,
      host: String,
      realm: String,
    ) {
      handler.cancel()
    }

    override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) {
      request.cancel()
    }

    override fun onSafeBrowsingHit(
      view: WebView,
      request: WebResourceRequest,
      threatType: Int,
      callback: SafeBrowsingResponseCompat,
    ) {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_RESPONSE_BACK_TO_SAFETY)) {
        callback.backToSafety(true)
      } else {
        view.stopLoading()
      }
      showConnectionError(StateKind.UNREACHABLE, R.string.blocked_title, R.string.blocked_message)
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      binding.webContainer.removeView(view)
      view.destroy()
      webView = null
      showState(
        StateKind.RENDERER,
        R.string.renderer_title,
        R.string.renderer_message,
        R.string.retry,
        primaryAction = {
          if (createWebView()) loadConfiguredRemote(force = true)
        },
      )
      return true
    }

    private fun blockedResponse(): WebResourceResponse = WebResourceResponse(
      "text/plain",
      "utf-8",
      403,
      "Blocked by Sorcerer Remote",
      mapOf("Cache-Control" to "no-store"),
      ByteArrayInputStream(ByteArray(0)),
    )
  }

  private class HardenedChromeClient : WebChromeClient() {
    override fun onPermissionRequest(request: PermissionRequest) {
      request.deny()
    }

    override fun onGeolocationPermissionsShowPrompt(
      origin: String,
      callback: GeolocationPermissions.Callback,
    ) {
      callback.invoke(origin, false, false)
    }

    override fun onShowFileChooser(
      webView: WebView,
      filePathCallback: ValueCallback<Array<Uri>>,
      fileChooserParams: FileChooserParams,
    ): Boolean {
      filePathCallback.onReceiveValue(null)
      return true
    }

    override fun onCreateWindow(
      view: WebView,
      isDialog: Boolean,
      isUserGesture: Boolean,
      resultMsg: android.os.Message,
    ): Boolean = false
  }

  private enum class StateKind {
    NONE,
    MISSING,
    PERMISSION,
    UNREACHABLE,
    AUTH,
    INCOMPATIBLE,
    TLS,
    WEBVIEW,
    RENDERER,
  }

  companion object {
    const val EXTRA_CONNECTION_UPDATED = "connection_updated"
  }
}
