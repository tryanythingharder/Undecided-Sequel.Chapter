package com.sixworlds.mobile.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.dataStore by preferencesDataStore(name = "sixworlds_settings")

/** API Key 系统级加密存储：AndroidKeyStore AES/GCM。 */
object CryptoBox {
    private const val ALIAS = "sixworlds-apikey"
    private const val IV_LEN = 12

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv + ct, Base64.NO_WRAP)
    }

    fun decrypt(data: String): String {
        val raw = Base64.decode(data, Base64.NO_WRAP)
        require(raw.size > IV_LEN) { "密文格式无效" }
        val iv = raw.copyOfRange(0, IV_LEN)
        val ct = raw.copyOfRange(IV_LEN, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }
}

/** 插图配置（对齐桌面设置·插图页签） */
data class IllustSettings(
    val auto: Boolean = false,
    val enabled: Boolean = false,          // 插图功能总开关（illustPreset off/on 的等价）
    val baseUrl: String = "",
    val apiKey: String = "",
    val model: String = "",
    val style: String = "日系轻小说",
    val custom: String = "",
    val size: String = "1344x768",
    val negative: String = "",
    val seedLock: Boolean = false,
    val seed: String = "",
    val n: Int = 1,
    val minLen: Int = 80,
    val prefixEnable: Boolean = true,
    val prefix: String = "A scene illustration from a Japanese fantasy light novel.",
)

/** 全量应用配置（对齐原型设置五页签） */
data class ChatSettings(
    // 接口
    val baseUrl: String = "",
    val apiKey: String = "",
    val model: String = "",
    val models: List<String> = emptyList(),   // 勾选出现在对话栏的模型
    val provider: String = "自定义",
    val thinkLevel: String = "default",
    // 玩法
    val kernelFile: String = "kernel.md",
    val ctxCount: Int = 24,
    // 外观
    val themeId: String = "amber",
    val mode: String = "dark",                // dark/light/auto
    val fontSizeIdx: Int = 1,
    val radiusIdx: Int = 3,
    val densityIdx: Int = 1,
    val bubbleWidthIdx: Int = 1,
    val skipSplash: Boolean = false,
    val serifFont: Boolean = true,
    // 插图
    val illust: IllustSettings = IllustSettings(),
)

class SettingsRepository(private val context: Context) {

    private object K {
        val baseUrl = stringPreferencesKey("base_url")
        val apiKeyEnc = stringPreferencesKey("api_key_enc")
        val model = stringPreferencesKey("model")
        val models = stringPreferencesKey("models_csv")
        val provider = stringPreferencesKey("provider")
        val think = stringPreferencesKey("think_level")
        val kernel = stringPreferencesKey("kernel_file")
        val ctx = intPreferencesKey("ctx_count")
        val themeId = stringPreferencesKey("theme_id")
        val mode = stringPreferencesKey("mode")
        val fontSizeIdx = intPreferencesKey("font_size_idx")
        val radiusIdx = intPreferencesKey("radius_idx")
        val densityIdx = intPreferencesKey("density_idx")
        val bubbleWidthIdx = intPreferencesKey("bubble_width_idx")
        val skipSplash = booleanPreferencesKey("skip_splash")
        val serifFont = booleanPreferencesKey("serif_font")
        val iAuto = booleanPreferencesKey("illust_auto")
        val iEnabled = booleanPreferencesKey("illust_enabled")
        val iBaseUrl = stringPreferencesKey("illust_base_url")
        val iApiKeyEnc = stringPreferencesKey("illust_api_key_enc")
        val iModel = stringPreferencesKey("illust_model")
        val iStyle = stringPreferencesKey("illust_style")
        val iCustom = stringPreferencesKey("illust_custom")
        val iSize = stringPreferencesKey("illust_size")
        val iNegative = stringPreferencesKey("illust_negative")
        val iSeedLock = booleanPreferencesKey("illust_seed_lock")
        val iSeed = stringPreferencesKey("illust_seed")
        val iN = intPreferencesKey("illust_n")
        val iMinLen = intPreferencesKey("illust_min_len")
        val iPrefixEnable = booleanPreferencesKey("illust_prefix_enable")
        val iPrefix = stringPreferencesKey("illust_prefix")
    }

    private fun decryptKey(p: androidx.datastore.preferences.core.Preferences, key: androidx.datastore.preferences.core.Preferences.Key<String>): String =
        p[key]?.let { runCatching { CryptoBox.decrypt(it) }.getOrDefault("") } ?: ""

    val settings: Flow<ChatSettings> = context.dataStore.data.map { p ->
        ChatSettings(
            baseUrl = p[K.baseUrl] ?: "",
            apiKey = decryptKey(p, K.apiKeyEnc),
            model = p[K.model] ?: "",
            models = (p[K.models] ?: "").split(',').filter { it.isNotBlank() },
            provider = p[K.provider] ?: "自定义",
            thinkLevel = p[K.think] ?: "default",
            kernelFile = p[K.kernel] ?: "kernel.md",
            ctxCount = p[K.ctx] ?: 24,
            themeId = p[K.themeId] ?: "amber",
            mode = p[K.mode] ?: "dark",
            fontSizeIdx = p[K.fontSizeIdx] ?: 1,
            radiusIdx = p[K.radiusIdx] ?: 3,
            densityIdx = p[K.densityIdx] ?: 1,
            bubbleWidthIdx = p[K.bubbleWidthIdx] ?: 1,
            skipSplash = p[K.skipSplash] ?: false,
            serifFont = p[K.serifFont] ?: true,
            illust = IllustSettings(
                auto = p[K.iAuto] ?: false,
                enabled = p[K.iEnabled] ?: false,
                baseUrl = p[K.iBaseUrl] ?: "",
                apiKey = decryptKey(p, K.iApiKeyEnc),
                model = p[K.iModel] ?: "",
                style = p[K.iStyle] ?: "日系轻小说",
                custom = p[K.iCustom] ?: "",
                size = p[K.iSize] ?: "1344x768",
                negative = p[K.iNegative] ?: "",
                seedLock = p[K.iSeedLock] ?: false,
                seed = p[K.iSeed] ?: "",
                n = p[K.iN] ?: 1,
                minLen = p[K.iMinLen] ?: 80,
                prefixEnable = p[K.iPrefixEnable] ?: true,
                prefix = p[K.iPrefix] ?: "A scene illustration from a Japanese fantasy light novel.",
            ),
        )
    }

    suspend fun current(): ChatSettings = settings.first()

    suspend fun save(s: ChatSettings) {
        context.dataStore.edit { p ->
            p[K.baseUrl] = s.baseUrl.trim()
            if (s.apiKey.isBlank()) p.remove(K.apiKeyEnc) else p[K.apiKeyEnc] = CryptoBox.encrypt(s.apiKey)
            p[K.model] = s.model.trim()
            p[K.models] = s.models.joinToString(",")
            p[K.provider] = s.provider
            p[K.think] = s.thinkLevel
            p[K.kernel] = s.kernelFile
            p[K.ctx] = s.ctxCount
            p[K.themeId] = s.themeId
            p[K.mode] = s.mode
            p[K.fontSizeIdx] = s.fontSizeIdx
            p[K.radiusIdx] = s.radiusIdx
            p[K.densityIdx] = s.densityIdx
            p[K.bubbleWidthIdx] = s.bubbleWidthIdx
            p[K.skipSplash] = s.skipSplash
            p[K.serifFont] = s.serifFont
            p[K.iAuto] = s.illust.auto
            p[K.iEnabled] = s.illust.enabled
            p[K.iBaseUrl] = s.illust.baseUrl.trim()
            if (s.illust.apiKey.isBlank()) p.remove(K.iApiKeyEnc) else p[K.iApiKeyEnc] = CryptoBox.encrypt(s.illust.apiKey)
            p[K.iModel] = s.illust.model.trim()
            p[K.iStyle] = s.illust.style
            p[K.iCustom] = s.illust.custom
            p[K.iSize] = s.illust.size
            p[K.iNegative] = s.illust.negative
            p[K.iSeedLock] = s.illust.seedLock
            p[K.iSeed] = s.illust.seed
            p[K.iN] = s.illust.n
            p[K.iMinLen] = s.illust.minLen
            p[K.iPrefixEnable] = s.illust.prefixEnable
            p[K.iPrefix] = s.illust.prefix
        }
    }
}
