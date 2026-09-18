package com.aetherci.sorcerer.remote

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.aetherci.sorcerer.remote.databinding.ActivityPairBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import java.util.Locale

class PairActivity : AppCompatActivity() {
  private lateinit var binding: ActivityPairBinding
  private lateinit var connectionStore: SecureConnectionStore
  private val pairingViewModel: PairingViewModel by viewModels()
  private var pendingRequest: PairingRequest? = null
  private var deepLinkHandled = false
  private var confirmationPending = false
  private var confirmationFromLink = false
  private var pairingWasInterrupted = false
  private var confirmationDialog: androidx.appcompat.app.AlertDialog? = null

  private val permissionLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) { granted ->
    if (granted) {
      (pendingRequest ?: validateManualRequest())?.let(::startPairing)
    } else {
      showStatus(getString(R.string.permission_message))
      if (!LocalNetworkAccess.canRequestAgain(this)) showPermissionSettingsDialog()
    }
  }

  private val settingsLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult(),
  ) {
    val request = pendingRequest ?: validateManualRequest() ?: return@registerForActivityResult
    if (LocalNetworkAccess.hasPermission(this)) {
      startPairing(request)
    } else {
      showStatus(getString(R.string.permission_message))
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    binding = ActivityPairBinding.inflate(layoutInflater)
    setContentView(binding.root)
    applyInsets()

    connectionStore = SecureConnectionStore(this)
    deepLinkHandled = savedInstanceState?.getBoolean(KEY_DEEP_LINK_HANDLED, false) == true
    confirmationPending = savedInstanceState?.getBoolean(KEY_CONFIRMATION_PENDING, false) == true
    confirmationFromLink = savedInstanceState?.getBoolean(KEY_CONFIRMATION_FROM_LINK, false) == true
    pairingWasInterrupted = savedInstanceState?.getBoolean(KEY_PAIRING_WAS_RUNNING, false) == true

    setSupportActionBar(binding.toolbar)
    supportActionBar?.setDisplayHomeAsUpEnabled(true)

    binding.schemeInput.setAdapter(
      ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, listOf("http", "https")),
    )
    if (savedInstanceState == null) populateExistingConnection()

    binding.cancelButton.setOnClickListener { finish() }
    binding.pairButton.setOnClickListener { validateManualRequest()?.let { confirmOrPair(it, false) } }
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (pairingViewModel.state.value is PairingOperationState.Running) {
          Toast.makeText(this@PairActivity, R.string.pairing_wait, Toast.LENGTH_SHORT).show()
        } else {
          finish()
        }
      }
    })
    observePairingOperation()

    if (!deepLinkHandled && intent?.data != null) {
      binding.root.post { handlePairingLink(intent.dataString.orEmpty()) }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (pairingViewModel.state.value is PairingOperationState.Running) {
      Toast.makeText(this, R.string.pairing_wait, Toast.LENGTH_SHORT).show()
      return
    }
    setIntent(intent)
    intent.dataString?.let(::handlePairingLink)
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putBoolean(KEY_DEEP_LINK_HANDLED, deepLinkHandled)
    outState.putBoolean(KEY_CONFIRMATION_PENDING, confirmationPending)
    outState.putBoolean(KEY_CONFIRMATION_FROM_LINK, confirmationFromLink)
    outState.putBoolean(
      KEY_PAIRING_WAS_RUNNING,
      pairingViewModel.state.value is PairingOperationState.Running,
    )
    super.onSaveInstanceState(outState)
  }

  override fun onPostCreate(savedInstanceState: Bundle?) {
    super.onPostCreate(savedInstanceState)
    if (savedInstanceState?.getBoolean(KEY_CONFIRMATION_PENDING, false) != true ||
      pairingViewModel.state.value is PairingOperationState.Running
    ) {
      return
    }
    binding.root.post {
      val linkRequest = intent?.dataString?.takeIf { confirmationFromLink }?.let { link ->
        (PairingLink.parse(link) as? PairingLinkResult.Valid)?.request
      }
      (linkRequest ?: validateManualRequest())?.let {
        showConfirmation(it, fromLink = confirmationFromLink)
      }
    }
  }

  override fun onSupportNavigateUp(): Boolean {
    if (pairingViewModel.state.value is PairingOperationState.Running) {
      Toast.makeText(this, R.string.pairing_wait, Toast.LENGTH_SHORT).show()
    } else {
      finish()
    }
    return true
  }

  override fun onDestroy() {
    confirmationDialog?.dismiss()
    super.onDestroy()
  }

  private fun observePairingOperation() {
    pairingViewModel.state.observe(this) { state ->
      when (state) {
        PairingOperationState.Idle -> {
          setFormEnabled(true)
          binding.pairingProgress.visibility = View.GONE
          if (pairingWasInterrupted) {
            pairingWasInterrupted = false
            showStatus(getString(R.string.pairing_interrupted))
          }
        }
        is PairingOperationState.Running -> {
          pairingWasInterrupted = false
          pendingRequest = state.request
          setFormEnabled(false)
          binding.pairingProgress.visibility = View.VISIBLE
          showStatus(getString(R.string.pairing), isError = false)
        }
        is PairingOperationState.Completed -> handlePairingResult(state.request, state.result)
      }
    }
  }

  private fun applyInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
      val systemBars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime(),
      )
      view.updatePadding(
        left = systemBars.left,
        top = systemBars.top,
        right = systemBars.right,
        bottom = systemBars.bottom,
      )
      insets
    }
  }

  private fun populateExistingConnection() {
    val existing = connectionStore.load()?.endpoint
    binding.schemeInput.setText(existing?.scheme ?: "http", false)
    binding.hostInput.setText(existing?.host.orEmpty())
    binding.portInput.setText(String.format(Locale.US, "%d", existing?.port ?: DEFAULT_PORT))
  }

  private fun handlePairingLink(link: String) {
    deepLinkHandled = true
    confirmationDialog?.dismiss()
    confirmationPending = false
    confirmationFromLink = false
    when (val parsed = PairingLink.parse(link)) {
      is PairingLinkResult.Invalid -> MaterialAlertDialogBuilder(this)
        .setTitle(R.string.invalid_link_title)
        .setMessage(parsed.reason)
        .setPositiveButton(android.R.string.ok, null)
        .show()
      is PairingLinkResult.Valid -> {
        val request = parsed.request
        binding.schemeInput.setText(request.endpoint.scheme, false)
        binding.hostInput.setText(request.endpoint.host)
        binding.portInput.setText(String.format(Locale.US, "%d", request.endpoint.port))
        binding.codeInput.setText(request.code)
        clearErrors()
        confirmOrPair(request, true)
      }
    }
  }

  private fun validateManualRequest(): PairingRequest? {
    clearErrors()
    val validation = ConnectionEndpoint.validate(
      binding.schemeInput.text?.toString().orEmpty(),
      binding.hostInput.text?.toString().orEmpty(),
      binding.portInput.text?.toString()?.toIntOrNull(),
    )
    val endpoint = when (validation) {
      is EndpointValidation.Valid -> validation.endpoint
      is EndpointValidation.Invalid -> {
        when (validation.field) {
          EndpointField.SCHEME -> binding.schemeLayout.error = validation.reason
          EndpointField.HOST -> binding.hostLayout.error = validation.reason
          EndpointField.PORT -> binding.portLayout.error = validation.reason
        }
        return null
      }
    }
    val code = binding.codeInput.text?.toString()?.trim().orEmpty()
    if (!PAIRING_CODE_PATTERN.matches(code)) {
      binding.codeLayout.error = getString(R.string.invalid_pairing_code)
      return null
    }
    return PairingRequest(endpoint, code, PairingLink.PROTOCOL_VERSION)
  }

  private fun clearErrors() {
    binding.schemeLayout.error = null
    binding.hostLayout.error = null
    binding.portLayout.error = null
    binding.codeLayout.error = null
    binding.statusMessage.visibility = View.GONE
  }

  private fun confirmOrPair(request: PairingRequest, alwaysConfirm: Boolean) {
    val existing = connectionStore.load()
    if (!alwaysConfirm && existing == null) {
      requestPermissionOrPair(request)
      return
    }

    showConfirmation(request, existing, fromLink = alwaysConfirm)
  }

  private fun showConfirmation(
    request: PairingRequest,
    existing: ConnectionRecord? = connectionStore.load(),
    fromLink: Boolean = false,
  ) {
    confirmationDialog?.dismiss()
    confirmationPending = true
    confirmationFromLink = fromLink
    val replacing = existing != null
    val message = if (replacing) {
      getString(
        R.string.replace_confirmation_message,
        existing?.endpoint?.origin,
        request.endpoint.origin,
      )
    } else {
      getString(R.string.pair_confirmation_message, request.endpoint.origin)
    }
    confirmationDialog = MaterialAlertDialogBuilder(this)
      .setTitle(if (replacing) R.string.replace_confirmation_title else R.string.pair_confirmation_title)
      .setMessage(message)
      .setNegativeButton(R.string.cancel) { _, _ ->
        confirmationPending = false
        confirmationFromLink = false
      }
      .setPositiveButton(R.string.confirm_pair) { _, _ ->
        confirmationPending = false
        confirmationFromLink = false
        requestPermissionOrPair(request)
      }
      .setOnCancelListener {
        confirmationPending = false
        confirmationFromLink = false
      }
      .create()
      .also { it.show() }
  }

  private fun requestPermissionOrPair(request: PairingRequest) {
    pendingRequest = request
    if (LocalNetworkAccess.isGranted(this, request.endpoint)) {
      startPairing(request)
      return
    }
    requestLocalNetworkPermission(request)
  }

  private fun requestLocalNetworkPermission(request: PairingRequest) {
    pendingRequest = request
    if (LocalNetworkAccess.canRequestAgain(this)) {
      LocalNetworkAccess.markRequested(this)
      permissionLauncher.launch(LocalNetworkAccess.PERMISSION)
    } else {
      showStatus(getString(R.string.permission_message))
      showPermissionSettingsDialog()
    }
  }

  private fun showPermissionSettingsDialog() {
    MaterialAlertDialogBuilder(this)
      .setTitle(R.string.permission_title)
      .setMessage(R.string.permission_message)
      .setNegativeButton(R.string.cancel, null)
      .setPositiveButton(R.string.open_settings) { _, _ ->
        settingsLauncher.launch(LocalNetworkAccess.appSettingsIntent(this))
      }
      .show()
  }

  private fun startPairing(request: PairingRequest) {
    pendingRequest = request
    pairingViewModel.start(request, deviceName(), LocalNetworkAccess.hasPermission(this))
  }

  private fun handlePairingResult(request: PairingRequest, result: PairingResult) {
    if (isFinishing || isDestroyed) return
    when (result) {
      PairingResult.LocalNetworkPermissionRequired -> {
        pairingViewModel.reset()
        setFormEnabled(true)
        binding.pairingProgress.visibility = View.GONE
        requestLocalNetworkPermission(request)
      }
      is PairingResult.Failure -> {
        setFormEnabled(true)
        binding.pairingProgress.visibility = View.GONE
        showStatus(result.message)
      }
      is PairingResult.Success -> {
        try {
          connectionStore.save(
            ConnectionRecord(
              request.endpoint,
              result.token,
              result.requiresLocalNetworkAccess,
            ),
          )
        } catch (_: Exception) {
          pairingViewModel.reset()
          setFormEnabled(true)
          binding.pairingProgress.visibility = View.GONE
          showStatus(getString(R.string.secure_storage_failed))
          return
        }
        pairingViewModel.reset()
        Toast.makeText(this, R.string.pairing_success, Toast.LENGTH_SHORT).show()
        setResult(RESULT_OK)
        startActivity(
          Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_CONNECTION_UPDATED, true),
        )
        finish()
      }
    }
  }

  private fun setFormEnabled(enabled: Boolean) {
    binding.schemeLayout.isEnabled = enabled
    binding.hostLayout.isEnabled = enabled
    binding.portLayout.isEnabled = enabled
    binding.codeLayout.isEnabled = enabled
    binding.pairButton.isEnabled = enabled
    binding.cancelButton.isEnabled = enabled
  }

  private fun showStatus(message: String, isError: Boolean = true) {
    binding.statusMessage.text = message
    binding.statusMessage.setTextColor(
      getColor(if (isError) R.color.sorcerer_error else R.color.sorcerer_secondary),
    )
    binding.statusMessage.visibility = View.VISIBLE
  }

  private fun deviceName(): String {
    val manufacturer = Build.MANUFACTURER.trim()
    val model = Build.MODEL.trim()
    return when {
      manufacturer.isBlank() -> model
      model.lowercase(Locale.US).startsWith(manufacturer.lowercase(Locale.US)) -> model
      else -> "$manufacturer $model"
    }.ifBlank { "Android device" }
  }

  companion object {
    private const val DEFAULT_PORT = 7437
    private const val KEY_DEEP_LINK_HANDLED = "deep_link_handled"
    private const val KEY_CONFIRMATION_PENDING = "confirmation_pending"
    private const val KEY_CONFIRMATION_FROM_LINK = "confirmation_from_link"
    private const val KEY_PAIRING_WAS_RUNNING = "pairing_was_running"
    private val PAIRING_CODE_PATTERN = Regex("^[A-Za-z0-9_-]{6,128}$")
  }
}
