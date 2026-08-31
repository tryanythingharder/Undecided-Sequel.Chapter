package com.sixworlds.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sixworlds.mobile.chat.StoryChatController
import com.sixworlds.mobile.ui.ChatScreen
import com.sixworlds.mobile.ui.DrawerScreen
import com.sixworlds.mobile.ui.ForkScreen
import com.sixworlds.mobile.ui.GalleryScreen
import com.sixworlds.mobile.ui.HelpScreen
import com.sixworlds.mobile.ui.SearchScreen
import com.sixworlds.mobile.ui.SettingsScreen
import com.sixworlds.mobile.ui.SplashScreen
import com.sixworlds.mobile.ui.theme.LocalSwColors
import com.sixworlds.mobile.ui.theme.swColors
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { SixWorldsRoot() }
    }
}

@Composable
private fun SixWorldsRoot() {
    val app = androidx.compose.ui.platform.LocalContext.current.applicationContext as SixWorldsApp
    val controller: StoryChatController = viewModel(key = "story-chat") {
        StoryChatController(
            bridge = app.engineBridge,
            client = app.chatClient,
            settingsRepo = app.settingsRepository,
            sessionStore = app.sessionStore,
            engineRuntime = app.engineRuntime,
            kernelTextLoader = app.kernelTextLoader,
            notifyCallback = { t, b -> app.notifyDone(t, b) },
        )
    }
    val settings by controller.settingsFlow.collectAsState()
    val dark = when (settings.mode) {
        "light" -> false
        "auto" -> isSystemInDarkTheme()
        else -> true
    }
    val swColors = swColors(dark)

    // 状态栏图标对比度跟随应用主题（应用强制暗色而系统为亮色时，深色图标会在黑底上消失）
    val view = androidx.compose.ui.platform.LocalView.current
    val window = (view.context as? android.app.Activity)?.window
    window?.let {
        androidx.core.view.WindowCompat.getInsetsController(it, view).isAppearanceLightStatusBars = !dark
    }

    CompositionLocalProvider(LocalSwColors provides swColors) {
        MaterialTheme(
            colorScheme = if (dark) darkColorScheme(primary = swColors.gold, background = swColors.bg)
            else lightColorScheme(primary = swColors.gold, background = swColors.bg),
        ) {
            var splashDone by rememberSaveable { mutableStateOf(false) }
            LaunchedEffect(settings.skipSplash) {
                if (settings.skipSplash) splashDone = true
            }
            var screen by rememberSaveable { mutableStateOf("chat") }

            if (!splashDone) {
                SplashScreen { splashDone = true }
                return@MaterialTheme
            }

            val goBack: () -> Unit = { screen = "chat" }
            val sheets = setOf("state", "snapshots", "pending", "illustrations", "modelConfig", "appearance", "worldSwitch")
            val baseRoute = if (screen in sheets) "chat" else if (screen.startsWith("backtrack")) "chat" else screen

            AnimatedContent(
                targetState = baseRoute,
                transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(160)) },
                label = "nav",
            ) { route ->
                when {
                    route == "chat" -> ChatScreen(controller = controller, onOpen = { screen = it })
                    route == "drawer" -> {
                        BackHandler(onBack = goBack)
                        DrawerScreen(controller = controller, onClose = goBack, onOpen = { screen = it })
                    }
                    route == "search" -> {
                        BackHandler(onBack = goBack)
                        SearchScreen(controller = controller, onBack = goBack)
                    }
                    route == "settings" -> {
                        BackHandler(onBack = goBack)
                        SettingsScreen(controller = controller, onBack = goBack)
                    }
                    route == "gallery" -> {
                        BackHandler(onBack = goBack)
                        GalleryScreen(controller = controller, onBack = goBack)
                    }
                    route == "help" -> {
                        BackHandler(onBack = goBack)
                        HelpScreen(onBack = goBack)
                    }
                    route.startsWith("fork:") -> {
                        BackHandler(onBack = goBack)
                        ForkScreen(
                            controller = controller,
                            msgIndex = route.substringAfter("fork:").toIntOrNull() ?: -1,
                            onBack = goBack,
                            onForked = goBack,
                        )
                    }
                    else -> ChatScreen(controller = controller, onOpen = { screen = it })
                }
            }

            // Sheet 浮层（覆盖在 Chat 之上；返回键关闭浮层而非退出）
            if (screen in sheets) BackHandler(onBack = goBack)
            when (screen) {
                "state" -> com.sixworlds.mobile.ui.StateSheet(controller = controller, onClose = goBack)
                "snapshots" -> com.sixworlds.mobile.ui.SnapshotsSheet(controller = controller, onClose = goBack)
                "pending" -> com.sixworlds.mobile.ui.RerecordSheet(controller = controller, onClose = goBack)
                "illustrations" -> com.sixworlds.mobile.ui.IllustrationsSheet(controller = controller, onClose = goBack)
                "modelConfig" -> com.sixworlds.mobile.ui.ModelConfigSheet(controller = controller, onClose = goBack)
                "appearance" -> com.sixworlds.mobile.ui.AppearanceSheet(controller = controller, onClose = goBack)
                "worldSwitch" -> com.sixworlds.mobile.ui.WorldSwitchSheet(controller = controller, onClose = goBack)
            }

            // 全局 Toast（最后渲染 = 永远在最上层，Sheet 打开时也可见）
            val toast by controller.toast.collectAsState()
            toast?.let { t ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                    Text(
                        t,
                        Modifier
                            .padding(bottom = 120.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(swColors.bgTertiary)
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        color = swColors.label, fontSize = 12.sp,
                    )
                }
            }
        }
    }
}
