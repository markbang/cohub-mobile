package io.github.markbang.cohubmobile.deviceruntime.helper

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Seals the Wireless debugging key under an Android Keystore AES key, as upstream's CredentialCipher does. */
internal class KeyCipher(private val alias: String) {
    fun seal(plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(AAD)
        val iv = cipher.iv
        check(iv.size == IV_BYTES) { "Unexpected IV length ${iv.size}" }
        return byteArrayOf(VERSION) + iv + cipher.doFinal(plaintext)
    }

    fun open(sealed: ByteArray): ByteArray {
        if (sealed.size < HEADER_BYTES + TAG_BYTES || sealed[0] != VERSION) throw AEADBadTagException("Unrecognised key envelope")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BYTES * 8, sealed, 1, IV_BYTES))
        cipher.updateAAD(AAD)
        return cipher.doFinal(sealed, HEADER_BYTES, sealed.size - HEADER_BYTES)
    }

    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).run {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val VERSION: Byte = 1
        const val IV_BYTES = 12
        const val TAG_BYTES = 16
        const val HEADER_BYTES = 1 + IV_BYTES
        val AAD = "io.github.markbang.cohubmobile/adb-key/v1".encodeToByteArray()
    }
}
