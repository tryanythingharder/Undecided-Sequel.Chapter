package com.sixworlds.mobile

import android.app.Application
import com.sixworlds.mobile.chat.StoryChatController
import com.sixworlds.mobile.data.ChatClient
import com.sixworlds.mobile.data.SessionStore
import com.sixworlds.mobile.data.SettingsRepository
import com.sixworlds.mobile.engine.EngineBridge
import com.sixworlds.mobile.engine.EngineRuntime

/**
 * 全局单例容器。桌面端对应关系：
 *  EngineRuntime+EngineBridge ≙ main.cjs 里的 createEngine(userData/story-engine) 与 IPC 层
 *  ChatClient               ≙ main.cjs 的 chat:send（OpenAI 兼容流式）
 *  SettingsRepository       ≙ localStorage 里的模型配置（密钥改为系统级加密）
 *  SessionStore             ≙ localStorage 里的叙事会话
 */
class SixWorldsApp : Application() {

    val engineRuntime: EngineRuntime by lazy { EngineRuntime(this) }
    val engineBridge: EngineBridge by lazy { EngineBridge(engineRuntime) }
    val chatClient: ChatClient by lazy { ChatClient() }
    val settingsRepository: SettingsRepository by lazy { SettingsRepository(this) }
    val sessionStore: SessionStore by lazy { SessionStore(this) }

    /** 内核文本加载器：kernel*.md 构建时已从仓库根拷入 assets。 */
    val notifyDone: (String, String) -> Unit = { t, b ->
        com.sixworlds.mobile.util.Notify.notifyDone(this, t, b)
    }
    val kernelTextLoader: (String) -> String by lazy {
        { file: String ->
            assets.open(file).bufferedReader(Charsets.UTF_8).use { it.readText() }
        }
    }
}
