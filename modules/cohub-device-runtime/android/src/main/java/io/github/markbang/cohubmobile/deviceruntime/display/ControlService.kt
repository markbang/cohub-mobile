package io.github.markbang.cohubmobile.deviceruntime.display

import android.accessibilityservice.AccessibilityService
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import androidx.annotation.RequiresApi
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import io.github.markbang.cohubmobile.deviceruntime.DeviceRuntime
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

@RequiresApi(Build.VERSION_CODES.R)
class ControlService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val settled = Runnable { readFocus() }
    private var overlay: Overlay? = null
    private var keepAlive: View? = null

    override fun onServiceConnected() {
        attachKeepAlive()
        DisplayControl.connected(this)
        val runtime = DeviceRuntime.get(applicationContext)
        overlay = Overlay(this, runtime.display, runtime.scope)
        if (runtime.shouldKeepControlAlive()) {
            runCatching { runtime.resume() }
                .onFailure { Log.w(TAG, "Control could not start the configured keep-alive service", it) }
        }
        Log.i(TAG, "Control connected on pid ${android.os.Process.myPid()}, keep-alive ${if (keepAlive != null) "attached" else "missing"}")
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        overlay?.refresh()
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        disconnect()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        main.removeCallbacks(settled)
        disconnect()
        super.onDestroy()
    }

    private fun disconnect() {
        overlay?.close()
        overlay = null
        DisplayControl.disconnected(this)
        detachKeepAlive()
    }

    /**
     * Some ROMs force-stop a process that shows no window when its task is swiped away, and a force
     * stop turns this service off in system settings. An invisible 1×1 accessibility overlay keeps the
     * process counted as showing a window. It needs no extra permission, is never focused and lets
     * every touch through.
     */
    private fun attachKeepAlive() {
        if (keepAlive != null) return
        val view = View(this)
        val params = WindowManager.LayoutParams().apply {
            type = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            format = PixelFormat.TRANSLUCENT
            flags = WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            gravity = Gravity.START or Gravity.TOP
            width = 1
            height = 1
        }
        // Best effort: control works without it, the service is only more likely to be turned off.
        runCatching { getSystemService(WindowManager::class.java).addView(view, params) }
            .onSuccess { keepAlive = view }
            .onFailure { Log.w(TAG, "The accessibility keep-alive window was refused", it) }
    }

    private fun detachKeepAlive() {
        val view = keepAlive ?: return
        keepAlive = null
        runCatching { getSystemService(WindowManager::class.java).removeView(view) }
            .onFailure { Log.w(TAG, "The accessibility keep-alive window could not be removed", it) }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        // Events name their display from Android 13; before that only the phone's own screen is served.
        val displayId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) event.displayId else Display.DEFAULT_DISPLAY
        if (event.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED || event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            DisplayControl.windowsChanged(displayId)
        }
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && event.isFullScreen && displayId == Display.DEFAULT_DISPLAY) {
            DisplayControl.foreground.value = event.packageName?.toString()
        }
        if (DisplayControl.followed.isEmpty()) return
        readFocus()
        main.removeCallbacks(settled)
        main.postDelayed(settled, FOCUS_SETTLE_MS)
    }

    internal fun refreshFocus() {
        main.post(settled)
    }

    private fun readFocus() {
        val all = windowsOnAllDisplays
        for (displayId in DisplayControl.followed.keys) {
            val windows = all[displayId].orEmpty()
            val typing = windows.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
            val node = if (typing) windows.firstNotNullOfOrNull { it.root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf(AccessibilityNodeInfo::isEditable) } else null
            DisplayControl.focusChanged(displayId, node?.let { FocusedField(Rect().also(it::getBoundsInScreen), it.isPassword) })
        }
    }

    override fun onInterrupt() = Unit

    private companion object {
        const val TAG = "CohubControl"
        const val FOCUS_SETTLE_MS = 300L
    }
}

data class FocusedField(val bounds: Rect, val password: Boolean)

@RequiresApi(Build.VERSION_CODES.R)
object DisplayControl {
    private val current = MutableStateFlow<ControlService?>(null)
    private val focused = MutableStateFlow<Map<Int, FocusedField>>(emptyMap())
    private val changes = MutableSharedFlow<Int>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    internal val followed = ConcurrentHashMap<Int, Int>()

    val service: StateFlow<ControlService?> = current.asStateFlow()

    val focus: StateFlow<Map<Int, FocusedField>> = focused.asStateFlow()

    val windows: SharedFlow<Int> = changes.asSharedFlow()

    val foreground = MutableStateFlow<String?>(null)

    internal fun followFocus(displayId: Int): () -> Unit {
        if (followed.merge(displayId, 1, Int::plus) == 1) current.value?.refreshFocus()
        val released = AtomicBoolean(false)
        return {
            if (released.compareAndSet(false, true) && followed.computeIfPresent(displayId) { _, count -> (count - 1).takeIf { it > 0 } } == null) {
                focused.update { it - displayId }
            }
        }
    }

    internal fun focusChanged(displayId: Int, value: FocusedField?) {
        focused.update { all ->
            when {
                !followed.containsKey(displayId) || value == null -> all - displayId
                else -> all + (displayId to value)
            }
        }
    }

    internal fun windowsChanged(displayId: Int) {
        changes.tryEmit(displayId)
    }

    internal fun connected(service: ControlService) {
        current.value = service
    }

    internal fun disconnected(service: ControlService) {
        if (current.value !== service) return
        current.value = null
        focused.value = emptyMap()
    }
}
