package io.github.markbang.cohubmobile.predictiveback

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.animation.DecelerateInterpolator
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.swmansion.rnscreens.Screen
import com.swmansion.rnscreens.ScreenStack
import java.util.WeakHashMap

/** Tunables and the route allowlist; JS owns the values (`src/platform/predictive-back.ts`). */
data class PredictiveBackOptions(
    val routes: Set<String> = emptySet(),
    val minScale: Float = 0.95f,
    val parallax: Float = 0.1f,
    val commitMs: Long = 180,
    val cancelMs: Long = 200,
    val popTimeoutMs: Long = 1500,
)

/**
 * System back for the Android app once `enableOnBackInvokedCallback` is on.
 *
 * Every back reaches React Native through [ComponentActivity.onBackPressed], exactly once. On
 * Android 14+, a back gesture over a stack screen whose route is allowlisted also drags the top
 * screen and previews the one react-native-screens keeps attached under it (see
 * `modules/react-native-screens/UPSTREAM.md`); the pop it commits then runs without a transition.
 */
object PredictiveBack : ScreenStack.PredictiveBackHost {
    private enum class Phase { IDLE, PASSTHROUGH, TRACKING, CANCELLING, COMMITTING, AWAITING_POP }

    @Volatile var options = PredictiveBackOptions()

    /** Set by JS while an in-screen overlay takes back itself (a menu, the Space panels). */
    @Volatile var blocked = false

    @Volatile var listener: ((phase: String, detail: Map<String, Any?>) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private val stacks = WeakHashMap<ScreenStack, Unit>()
    private var callback: Callback? = null

    val installed: Boolean get() = callback != null
    val animated: Boolean get() = installed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE

    /**
     * Called from `MainActivity.onCreate`, after React Native added its own back callback.
     * [gestureEnabled] is `android.predictiveBackGestureEnabled`; without it the system sends back
     * as KEYCODE_BACK straight to ReactActivity, and nothing here runs.
     */
    @JvmStatic
    fun install(
        activity: ComponentActivity,
        gestureEnabled: Boolean,
    ) {
        // Before Android 13 back always arrives as KEYCODE_BACK through ReactActivity.onBackPressed.
        if (!gestureEnabled || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val installedCallback = Callback(activity)
        callback = installedCallback
        ScreenStack.predictiveBackHost = this
        activity.onBackPressedDispatcher.addCallback(activity, installedCallback)
        activity.lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onDestroy(owner: LifecycleOwner) {
                    installedCallback.reset()
                    if (callback === installedCallback) callback = null
                }
            },
        )
    }

    /**
     * Called first in `MainActivity.invokeDefaultOnBackPressed`. React Native calls it when JS left
     * back unhandled; the activity default then goes through the dispatcher, which must not route
     * it back to JS.
     */
    @JvmStatic
    fun suspendForDefaultBack() {
        val current = callback ?: return
        current.isEnabled = false
        main.post { current.isEnabled = true }
    }

    override fun canPreviewBelow(top: Screen): Boolean {
        if (!animated) return false
        // Expo Router route keys are `<route name>:<chain>`; anything else never previews.
        val key = top.screenId ?: return false
        val separator = key.lastIndexOf(':')
        return separator > 0 && key.substring(0, separator) in options.routes
    }

    override fun onStackChanged(stack: ScreenStack) {
        if (stack.isAttachedToWindow) stacks[stack] = Unit else stacks.remove(stack)
        callback?.onStackChanged(stack)
    }

    fun phase(): String = callback?.phaseName() ?: "uninstalled"

    private fun emit(phase: String, detail: Map<String, Any?> = emptyMap()) {
        listener?.invoke(phase, detail)
    }

    private fun routeName(screen: Screen?): String? = screen?.screenId?.substringBeforeLast(':', "")?.takeIf { it.isNotEmpty() }

    private class Target(val stack: ScreenStack, val top: View, val below: View, val screen: Screen?)

    private sealed interface Lookup {
        class Found(val target: Target) : Lookup

        class Skipped(val reason: String) : Lookup
    }

    private fun findTarget(): Lookup {
        if (!animated) return Lookup.Skipped("unsupported")
        if (blocked) return Lookup.Skipped("blocked")
        val candidates =
            stacks.keys.mapNotNull { stack ->
                val (top, below) = stack.predictiveBackViews ?: return@mapNotNull null
                if (!stack.isAttachedToWindow || !top.isShown || !top.isLaidOut || top.width == 0) return@mapNotNull null
                Target(stack, top, below, stack.topScreen)
            }
        if (candidates.isEmpty()) return Lookup.Skipped("no_preview")
        // Two shown stacks with a preview would leave it unclear which one JS pops.
        if (candidates.size > 1) return Lookup.Skipped("ambiguous")
        val target = candidates.single()
        if (target.screen == null || !canPreviewBelow(target.screen)) return Lookup.Skipped("route")
        if (target.top.animation != null || target.below.animation != null) return Lookup.Skipped("transitioning")
        return Lookup.Found(target)
    }

    private class Callback(
        private val activity: ComponentActivity,
    ) : OnBackPressedCallback(true) {
        private var phase = Phase.IDLE
        private var target: Target? = null
        private var direction = 1f
        private var progress = 0f
        private var animator: ValueAnimator? = null
        private var ignoreGesture = false
        private var committedAt = 0L
        private val popTimeout = Runnable { onPopTimeout() }

        fun phaseName() = phase.name.lowercase()

        override fun handleOnBackStarted(backEvent: BackEventCompat) {
            when (phase) {
                Phase.COMMITTING, Phase.AWAITING_POP -> {
                    // One gesture pops once: a gesture during a pending pop does nothing.
                    ignoreGesture = true
                    emit("ignored", mapOf("reason" to phase.name.lowercase()))
                    return
                }
                Phase.CANCELLING -> reset()
                else -> {}
            }
            ignoreGesture = false
            when (val lookup = findTarget()) {
                is Lookup.Skipped -> {
                    phase = Phase.PASSTHROUGH
                    emit("passthrough", mapOf("reason" to lookup.reason))
                }
                is Lookup.Found -> {
                    val found = lookup.target
                    target = found
                    direction = if (backEvent.swipeEdge == BackEventCompat.EDGE_RIGHT) -1f else 1f
                    found.top.pivotX = if (direction > 0f) 0f else found.top.width.toFloat()
                    found.top.pivotY = found.top.height / 2f
                    found.stack.setPredictiveBackPreview(found.below, true)
                    phase = Phase.TRACKING
                    apply(0f)
                    emit("started", mapOf("route" to routeName(found.screen), "edge" to if (direction > 0f) "left" else "right"))
                }
            }
        }

        override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            if (ignoreGesture || phase != Phase.TRACKING) return
            apply(backEvent.progress.coerceIn(0f, 1f))
        }

        override fun handleOnBackCancelled() {
            if (ignoreGesture) {
                ignoreGesture = false
                return
            }
            when (phase) {
                Phase.TRACKING -> {
                    phase = Phase.CANCELLING
                    emit("cancelled", mapOf("progress" to progress))
                    animateTo(0f, options.cancelMs) { reset() }
                }
                Phase.PASSTHROUGH -> phase = Phase.IDLE
                else -> {}
            }
        }

        override fun handleOnBackPressed() {
            if (ignoreGesture) {
                ignoreGesture = false
                return
            }
            when (phase) {
                Phase.TRACKING -> commit()
                Phase.COMMITTING, Phase.AWAITING_POP -> emit("ignored", mapOf("reason" to phase.name.lowercase()))
                Phase.CANCELLING -> {
                    reset()
                    forward()
                }
                Phase.IDLE, Phase.PASSTHROUGH -> {
                    phase = Phase.IDLE
                    forward()
                }
            }
        }

        private fun commit() {
            val committed = target ?: return forward()
            phase = Phase.COMMITTING
            emit("committed", mapOf("progress" to progress))
            animateTo(1f, options.commitMs, exit = true) {
                if (target !== committed) return@animateTo
                phase = Phase.AWAITING_POP
                committedAt = SystemClock.uptimeMillis()
                committed.stack.markPredictiveBackPop()
                main.postDelayed(popTimeout, options.popTimeoutMs)
                forward()
            }
        }

        fun onStackChanged(stack: ScreenStack) {
            val current = target ?: return
            if (current.stack !== stack) return
            val stillPreviewing = stack.isAttachedToWindow && stack.predictiveBackViews?.let { it.first === current.top && it.second === current.below } == true
            when (phase) {
                Phase.AWAITING_POP ->
                    if (stack.topScreen !== current.screen) {
                        main.removeCallbacks(popTimeout)
                        emit("popped", mapOf("ms" to SystemClock.uptimeMillis() - committedAt))
                        // The stack already reset the revealed screen; the popped one is going away.
                        target = null
                        phase = Phase.IDLE
                    }
                Phase.TRACKING, Phase.CANCELLING, Phase.COMMITTING ->
                    if (!stillPreviewing) {
                        // The stack changed under the gesture (a push or pop from JS). Dropping
                        // this back is safer than popping a screen the user never dragged.
                        emit("aborted", mapOf("phase" to phase.name.lowercase()))
                        // A gesture still in progress ends without going back.
                        val inGesture = phase == Phase.TRACKING
                        reset()
                        ignoreGesture = inGesture
                    }
                else -> {}
            }
        }

        private fun onPopTimeout() {
            val current = target ?: return
            if (phase != Phase.AWAITING_POP) return
            current.stack.clearPredictiveBackPop()
            emit("timeout", mapOf("ms" to options.popTimeoutMs))
            phase = Phase.CANCELLING
            progress = 1f
            animateTo(0f, options.cancelMs) { reset() }
        }

        /** Applies gesture progress: the top screen follows the finger, the one below slides in. */
        private fun apply(value: Float) {
            val current = target ?: return
            progress = value
            val width = current.top.width.toFloat()
            val scale = 1f - (1f - options.minScale) * value
            current.top.translationX = direction * width * value
            current.top.scaleX = scale
            current.top.scaleY = scale
            current.below.translationX = -direction * width * options.parallax * (1f - value)
        }

        private fun animateTo(
            end: Float,
            durationMs: Long,
            exit: Boolean = false,
            onEnd: () -> Unit,
        ) {
            val current = target ?: return
            animator?.cancel()
            val width = current.top.width.toFloat()
            val fromTop = current.top.translationX
            val fromScale = current.top.scaleX
            val fromBelow = current.below.translationX
            // An exit keeps the shrunken scale and leaves the top screen fully off screen.
            val toTop = if (exit) direction * width else direction * width * end
            val toScale = if (exit) fromScale else 1f - (1f - options.minScale) * end
            val toBelow = -direction * width * options.parallax * (1f - end)
            animator =
                ValueAnimator.ofFloat(0f, 1f).apply {
                    duration = durationMs
                    interpolator = DecelerateInterpolator()
                    addUpdateListener {
                        val fraction = it.animatedValue as Float
                        current.top.translationX = fromTop + (toTop - fromTop) * fraction
                        current.top.scaleX = fromScale + (toScale - fromScale) * fraction
                        current.top.scaleY = current.top.scaleX
                        current.below.translationX = fromBelow + (toBelow - fromBelow) * fraction
                    }
                    addListener(
                        object : AnimatorListenerAdapter() {
                            private var cancelled = false

                            override fun onAnimationCancel(animation: Animator) {
                                cancelled = true
                            }

                            override fun onAnimationEnd(animation: Animator) {
                                if (animator === animation) animator = null
                                if (!cancelled) onEnd()
                            }
                        },
                    )
                    start()
                }
            progress = end
        }

        /** Puts both screens back in place and hides the one below again. */
        fun reset() {
            animator?.cancel()
            animator = null
            main.removeCallbacks(popTimeout)
            target?.let { current ->
                current.stack.clearPredictiveBackPop()
                current.top.translationX = 0f
                current.top.scaleX = 1f
                current.top.scaleY = 1f
                current.below.translationX = 0f
                current.stack.setPredictiveBackPreview(current.below, false)
            }
            target = null
            progress = 0f
            phase = Phase.IDLE
        }

        /** Hands back to React Native once; JS then pops, closes something, or leaves the app. */
        @Suppress("DEPRECATION")
        private fun forward() {
            isEnabled = false
            try {
                activity.onBackPressed()
            } finally {
                isEnabled = true
            }
        }
    }
}
