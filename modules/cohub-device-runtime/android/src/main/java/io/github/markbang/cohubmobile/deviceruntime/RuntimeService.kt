package io.github.markbang.cohubmobile.deviceruntime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.io.File
import java.util.UUID

private const val TAG = "CohubRuntime"

/** One foreground service keeps every enabled folder of the signed-in account connected. */
class RuntimeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val runtime: DeviceRuntime get() = DeviceRuntime.get(this)
    private val http by lazy { OkHttpClient() }

    private val sessions = mutableMapOf<String, Session>()
    private var watching: Job? = null

    private class Session(val root: String, val gateway: String, val job: Job)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP_ALL) {
            runtime.stopAll()
            return START_NOT_STICKY
        }
        // The runtime only starts where it is available (Android 11+ with the bridge binary).
        if (!runtime.available) {
            stopSelf()
            return START_NOT_STICKY
        }
        createChannel()
        if (!enterForeground()) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (watching == null) {
            watching = scope.launch(Dispatchers.Main.immediate) { runtime.enabled.collect(::reconcile) }
            scope.launch { runtime.instances.collect(::showNotification) }
        }
        // Tokens come from the running app, so a process the system restarts without it could not
        // connect. The app reconnects folders the user never disconnected when it next opens.
        return START_NOT_STICKY
    }

    private fun enterForeground(): Boolean = try {
        val types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(runtime.instances.value), types)
        true
    } catch (error: RuntimeException) {
        Log.w(TAG, "Runtime could not enter the foreground", error)
        false
    }

    override fun onDestroy() {
        scope.cancel()
        runtime.clearLive()
        super.onDestroy()
    }

    private fun reconcile(wanted: List<Binding>) {
        val gateway = runtime.gatewayOrigin
        if (wanted.isEmpty() || gateway == null || !runtime.hasStorageAccess()) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        val roots = wanted.associate { it.spaceId to it.root }
        val retired = sessions.filter { (spaceId, session) -> roots[spaceId] != session.root || session.gateway != gateway }
        retired.forEach { (spaceId, session) ->
            session.job.cancel()
            sessions.remove(spaceId)
        }
        for (binding in wanted) {
            if (binding.spaceId in sessions) continue
            val previous = retired[binding.spaceId]?.job
            sessions[binding.spaceId] = Session(
                binding.root,
                gateway,
                scope.launch {
                    previous?.join()
                    serve(binding, gateway)
                },
            )
        }
    }

    private suspend fun serve(binding: Binding, gateway: String) = coroutineScope {
        val spaceId = binding.spaceId
        val runtimeId = UUID.randomUUID().toString()
        val tokens = runtime.tokens
        val connection = RuntimeConnection(
            client = http,
            url = "$gateway/runtime/relay",
            spaceId = spaceId,
            runtimeId = runtimeId,
            token = tokens::get,
        )
        val bridge = SandboxBridge(
            binary = runtime.bridgeBinary,
            root = File(binding.root),
            home = File(filesDir, "cohub-runtime/$spaceId"),
            spaceId = spaceId,
            relayUrl = "$gateway/sandbox/relay",
            runtimeId = runtimeId,
            token = { tokens.get(false) },
        )
        runtime.publish(spaceId, RuntimeInstance.State.CONNECTING)
        val reporter = launch {
            combine(connection.ready, bridge.connected) { ready, connected -> ready && connected }
                .collect { ready ->
                    runtime.publish(spaceId, if (ready) RuntimeInstance.State.READY else RuntimeInstance.State.CONNECTING)
                }
        }
        launch { bridge.run(connection.ready) }
        try {
            connection.run()
        } catch (error: RuntimeRejected) {
            Log.w(TAG, "Runtime rejected for $spaceId: ${error.code}")
            reporter.cancelAndJoin()
            runtime.fail(spaceId, error.code)
            coroutineContext.cancelChildren()
        }
    }

    private fun showNotification(instances: List<RuntimeInstance>) {
        if (instances.none { it.running }) return
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(instances))
    }

    private fun notification(instances: List<RuntimeInstance>): Notification {
        val ready = instances.count { it.state == RuntimeInstance.State.READY }
        val text = if (ready > 0) {
            resources.getQuantityString(R.plurals.cohub_runtime_ready, ready, ready)
        } else {
            getString(R.string.cohub_runtime_connecting)
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.cohub_runtime_notification)
            .setContentTitle(getString(R.string.cohub_runtime_title))
            .setContentText(text)
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
        }
        val stop = PendingIntent.getService(
            this, 1, Intent(this, RuntimeService::class.java).setAction(ACTION_STOP_ALL), PendingIntent.FLAG_IMMUTABLE,
        )
        return builder
            .addAction(0, getString(R.string.cohub_runtime_disconnect), stop)
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, getString(R.string.cohub_runtime_channel), NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private companion object {
        const val CHANNEL_ID = "cohub-runtime"
        const val NOTIFICATION_ID = 0x0C0B
        const val ACTION_STOP_ALL = "io.github.markbang.cohubmobile.deviceruntime.STOP_ALL"
    }
}
