package com.aetherci.sorcerer.android

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.aetherci.sorcerer.android.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {
  private lateinit var binding: ActivitySettingsBinding
  private lateinit var connectionStore: ConnectionStore

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    binding = ActivitySettingsBinding.inflate(layoutInflater)
    setContentView(binding.root)

    connectionStore = ConnectionStore(this)
    setSupportActionBar(binding.toolbar)
    supportActionBar?.setDisplayHomeAsUpEnabled(true)

    val schemes = listOf("http", "https")
    val adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, schemes)
    binding.schemeInput.setAdapter(adapter)

    populateExistingConfig()

    binding.cancelButton.setOnClickListener { finish() }
    binding.saveButton.setOnClickListener { saveConfig() }
  }

  override fun onSupportNavigateUp(): Boolean {
    finish()
    return true
  }

  private fun populateExistingConfig() {
    val existing = connectionStore.load()
    binding.schemeInput.setText(existing?.scheme ?: ConnectionStore.DEFAULT_SCHEME, false)
    binding.hostInput.setText(existing?.host.orEmpty())
    binding.portInput.setText((existing?.port ?: ConnectionStore.DEFAULT_PORT).toString())
    binding.tokenInput.setText(existing?.token.orEmpty())
  }

  private fun saveConfig() {
    val scheme = binding.schemeInput.text?.toString()?.trim().orEmpty().ifBlank {
      ConnectionStore.DEFAULT_SCHEME
    }
    val host = binding.hostInput.text?.toString()?.trim().orEmpty()
    val token = binding.tokenInput.text?.toString()?.trim().orEmpty()
    val port = binding.portInput.text?.toString()?.trim()?.toIntOrNull()

    if (host.isBlank() || token.isBlank()) {
      Toast.makeText(this, R.string.error_missing_config, Toast.LENGTH_LONG).show()
      return
    }

    if (port == null || port !in 1..65535) {
      Toast.makeText(this, R.string.error_invalid_port, Toast.LENGTH_LONG).show()
      return
    }

    connectionStore.save(
      ConnectionConfig(
        scheme = scheme,
        host = host,
        port = port,
        token = token
      )
    )
    setResult(RESULT_OK)
    finish()
  }
}
