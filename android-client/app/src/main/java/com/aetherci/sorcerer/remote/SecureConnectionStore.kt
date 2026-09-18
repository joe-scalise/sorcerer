package com.aetherci.sorcerer.remote

import android.annotation.SuppressLint
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@SuppressLint("ApplySharedPref", "UseKtx")
class SecureConnectionStore(context: Context) {
  private val appContext = context.applicationContext
  private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  @Synchronized
  fun load(): ConnectionRecord? {
    val encoded = preferences.getString(KEY_ENCRYPTED_CONNECTION, null) ?: return null
    return try {
      val envelope = decodeEnvelope(Base64.decode(encoded, Base64.NO_WRAP)) ?: return clearCorruptRecord()
      val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, loadKey() ?: return clearCorruptRecord(), GCMParameterSpec(128, envelope.iv))
      cipher.updateAAD(ASSOCIATED_DATA)
      ConnectionRecordCodec.decode(cipher.doFinal(envelope.ciphertext)) ?: clearCorruptRecord()
    } catch (_: Exception) {
      clearCorruptRecord()
    }
  }

  @Synchronized
  fun save(record: ConnectionRecord) {
    val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    cipher.updateAAD(ASSOCIATED_DATA)
    val envelope = encodeEnvelope(cipher.iv, cipher.doFinal(ConnectionRecordCodec.encode(record)))
    check(
      preferences.edit()
        .putString(KEY_ENCRYPTED_CONNECTION, Base64.encodeToString(envelope, Base64.NO_WRAP))
        .commit(),
    ) { "Could not persist the encrypted connection" }
  }

  @Synchronized
  fun clear() {
    preferences.edit().remove(KEY_ENCRYPTED_CONNECTION).commit()
    val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
    if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
  }

  private fun getOrCreateKey(): SecretKey {
    loadKey()?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  private fun loadKey(): SecretKey? {
    val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
    return keyStore.getKey(KEY_ALIAS, null) as? SecretKey
  }

  private fun clearCorruptRecord(): ConnectionRecord? {
    preferences.edit().remove(KEY_ENCRYPTED_CONNECTION).commit()
    runCatching {
      val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
      if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    }
    return null
  }

  private data class Envelope(val iv: ByteArray, val ciphertext: ByteArray)

  private fun encodeEnvelope(iv: ByteArray, ciphertext: ByteArray): ByteArray =
    ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        output.writeInt(ENVELOPE_VERSION)
        output.writeInt(iv.size)
        output.write(iv)
        output.writeInt(ciphertext.size)
        output.write(ciphertext)
      }
      bytes.toByteArray()
    }

  private fun decodeEnvelope(bytes: ByteArray): Envelope? = try {
    DataInputStream(ByteArrayInputStream(bytes)).use { input ->
      if (input.readInt() != ENVELOPE_VERSION) return null
      val ivSize = input.readInt()
      if (ivSize !in 12..32) return null
      val iv = ByteArray(ivSize).also(input::readFully)
      val ciphertextSize = input.readInt()
      if (ciphertextSize !in 17..MAX_CIPHERTEXT_SIZE) return null
      val ciphertext = ByteArray(ciphertextSize).also(input::readFully)
      if (input.available() != 0) return null
      Envelope(iv, ciphertext)
    }
  } catch (_: Exception) {
    null
  }

  companion object {
    private const val PREFERENCES_NAME = "sorcerer_remote_secure"
    private const val KEY_ENCRYPTED_CONNECTION = "encrypted_connection"
    private const val KEY_ALIAS = "sorcerer_remote_connection_v1"
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val ENVELOPE_VERSION = 1
    private const val MAX_CIPHERTEXT_SIZE = 16 * 1024
    private val ASSOCIATED_DATA = "com.aetherci.sorcerer.remote/connection/v1".toByteArray()
  }
}
