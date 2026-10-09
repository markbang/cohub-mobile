package io.github.markbang.cohubmobile.deviceruntime

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.net.toUri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private class FolderUnavailableException(cause: FolderUnavailable) :
    CodedException("ERR_FOLDER_UNAVAILABLE", cause.message, cause)

private class GatewayOriginException(origin: String) :
    CodedException("ERR_GATEWAY_ORIGIN", "Gateway origin must be a wss:// origin without a path, received: $origin", null)

/** JS face of [DeviceRuntime]; Android only. Sign-in stays in JS, which supplies tokens on request. */
class DeviceRuntimeModule : Module() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var storageAccess: Promise? = null
    private val requester: (Boolean) -> Unit = { forceRefresh ->
        sendEvent("onTokenRequest", mapOf("forceRefresh" to forceRefresh))
    }

    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private val deviceRuntime: DeviceRuntime
        get() = DeviceRuntime.get(context)

    override fun definition() = ModuleDefinition {
        Name("CohubDeviceRuntime")
        Events("onChange", "onTokenRequest")

        OnCreate {
            val runtime = deviceRuntime
            runtime.tokens.requester = requester
            scope.launch {
                runtime.instances.collect { instances ->
                    sendEvent("onChange", mapOf("instances" to instances.map(RuntimeInstance::toMap)))
                }
            }
        }

        OnDestroy {
            val tokens = deviceRuntime.tokens
            if (tokens.requester === requester) tokens.requester = null
            storageAccess?.resolve(false)
            storageAccess = null
            scope.cancel()
        }

        // Returning from system settings is the only signal that the user decided on All files access.
        OnActivityEntersForeground {
            storageAccess?.resolve(deviceRuntime.hasStorageAccess())
            storageAccess = null
            deviceRuntime.resume()
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
    }

    private companion object {
        val GATEWAY_ORIGIN = Regex("^wss://[^/?#\\s]+$")
    }
}
