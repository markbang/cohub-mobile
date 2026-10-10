package io.github.markbang.cohubmobile.deviceruntime

import android.app.Activity
import android.app.AppOpsManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.net.toUri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private class FolderUnavailableException(cause: FolderUnavailable) :
    CodedException("ERR_FOLDER_UNAVAILABLE", cause.message, cause)

private class NotServingException :
    CodedException("ERR_NOT_SERVING", "This device does not serve that Space; connect its folder first", null)

private class GatewayOriginException(origin: String) :
    CodedException("ERR_GATEWAY_ORIGIN", "Gateway origin must be a wss:// origin without a path, received: $origin", null)

/** JS face of [DeviceRuntime]; Android only. Sign-in stays in JS, which supplies tokens on request. */
class DeviceRuntimeModule : Module() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var storageAccess: Promise? = null
    private var screenCapture: CompletableDeferred<Pair<Int, Intent>?>? = null
    private val requester: (Boolean) -> Unit = { forceRefresh ->
        sendEvent("onTokenRequest", mapOf("forceRefresh" to forceRefresh))
    }

    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private val deviceRuntime: DeviceRuntime
        get() = DeviceRuntime.get(context)

    override fun definition() = ModuleDefinition {
        Name("CohubDeviceRuntime")
        Events("onChange", "onDisplayChange", "onTokenRequest")

        OnCreate {
            val runtime = deviceRuntime
            runtime.tokens.requester = requester
            scope.launch {
                runtime.instances.collect { instances ->
                    sendEvent("onChange", mapOf("instances" to instances.map(RuntimeInstance::toMap)))
                }
            }
            scope.launch {
                runtime.display.status.collect { status -> sendEvent("onDisplayChange", status.toMap()) }
            }
        }

        OnDestroy {
            val tokens = deviceRuntime.tokens
            if (tokens.requester === requester) tokens.requester = null
            storageAccess?.resolve(false)
            storageAccess = null
            screenCapture?.complete(null)
            screenCapture = null
            scope.cancel()
        }

        // Returning from system settings is the only signal that the user decided on All files access.
        OnActivityEntersForeground {
            storageAccess?.resolve(deviceRuntime.hasStorageAccess())
            storageAccess = null
            deviceRuntime.resume()
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != SCREEN_CAPTURE_REQUEST) return@OnActivityResult
            val data = payload.data
            screenCapture?.complete(if (payload.resultCode == Activity.RESULT_OK && data != null) payload.resultCode to data else null)
            screenCapture = null
        }

        Function("isAvailable") { deviceRuntime.available }

        Function("hasStorageAccess") { deviceRuntime.hasStorageAccess() }

        AsyncFunction("requestStorageAccess") { promise: Promise ->
            if (deviceRuntime.hasStorageAccess()) return@AsyncFunction promise.resolve(true)
            val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
            storageAccess?.resolve(false)
            storageAccess = promise
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, "package:${context.packageName}".toUri()))
            } catch (_: ActivityNotFoundException) {
                // Some builds only expose the list of apps, not the per-app page.
                activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        }.runOnQueue(Queues.MAIN)

        Function("configure") { account: String, gatewayOrigin: String ->
            if (!GATEWAY_ORIGIN.matches(gatewayOrigin)) throw GatewayOriginException(gatewayOrigin)
            deviceRuntime.configure(account, gatewayOrigin)
            deviceRuntime.resume()
        }

        Function("supplyAccessToken") { token: String?, expiresAt: Double ->
            deviceRuntime.tokens.supply(token, expiresAt.toLong())
        }

        Function("signOut") { deviceRuntime.signOut() }

        Function("list") { deviceRuntime.instances.value.map(RuntimeInstance::toMap) }

        AsyncFunction("browse") Coroutine { path: String? ->
            try {
                deviceRuntime.browse(path).toMap()
            } catch (error: FolderUnavailable) {
                throw FolderUnavailableException(error)
            }
        }

        AsyncFunction("start") Coroutine { spaceId: String, root: String ->
            deviceRuntime.start(spaceId, root)
        }

        Function("stop") { spaceId: String -> deviceRuntime.stop(spaceId) }

        Function("displayStatus") { deviceRuntime.display.status.value.toMap() }

        // Resolves "declined" when the user refuses the system capture dialog, "failed" when sharing
        // could not start, and null once this screen is shared with the Space.
        AsyncFunction("shareDisplay") Coroutine { spaceId: String ->
            val runtime = deviceRuntime
            if (!runtime.serving(spaceId)) throw NotServingException()
            val (resultCode, data) = requestScreenCapture() ?: return@Coroutine "declined"
            try {
                val status = runtime.display.awaitShare(spaceId) { RuntimeService.share(context, spaceId, resultCode, data) }
                if (status.sharedWith == spaceId) null else "failed"
            } catch (_: TimeoutCancellationException) {
                "failed"
            }
        }

        Function("stopDisplay") { deviceRuntime.display.stop() }

        AsyncFunction("openControlSettings") {
            val context = context
            if (isControlRestricted(context)) {
                // Refused once as a restricted setting: App info now offers Allow restricted settings.
                context.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                Toast.makeText(context, R.string.cohub_display_control_restricted, Toast.LENGTH_LONG).show()
            } else {
                context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }.runOnQueue(Queues.MAIN)
    }

    private suspend fun requestScreenCapture(): Pair<Int, Intent>? = withContext(Dispatchers.Main) {
        val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
        val manager = activity.getSystemService(MediaProjectionManager::class.java)
        // The whole display: a single app would break input coordinates.
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            manager.createScreenCaptureIntent()
        }
        screenCapture?.complete(null)
        val result = CompletableDeferred<Pair<Int, Intent>?>()
        screenCapture = result
        activity.startActivityForResult(intent, SCREEN_CAPTURE_REQUEST)
        result.await()
    }

    private fun isControlRestricted(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        return runCatching {
            context.getSystemService(AppOpsManager::class.java)
                .unsafeCheckOpNoThrow(OP_ACCESS_RESTRICTED_SETTINGS, context.applicationInfo.uid, context.packageName) ==
                AppOpsManager.MODE_IGNORED
        }.getOrDefault(false)
    }

    private companion object {
        const val SCREEN_CAPTURE_REQUEST = 0x0C0B
        const val OP_ACCESS_RESTRICTED_SETTINGS = "android:access_restricted_settings"
        val GATEWAY_ORIGIN = Regex("^wss://[^/?#\\s]+$")
    }
}
