package io.github.markbang.cohubmobile.deviceruntime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import io.github.markbang.cohubmobile.deviceruntime.display.DisplayStatus
import io.github.markbang.cohubmobile.deviceruntime.display.launchDisplayProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.io.File
import java.util.UUID

private const val TAG = "CohubRuntime"

/**
 * One foreground service keeps every enabled folder of the signed-in account connected, and holds
 * the screen capture while this screen is shared: a projection must not outlive its service.
 */
class RuntimeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val runtime: DeviceRuntime get() = DeviceRuntime.get(this)
    private val http by lazy { OkHttpClient() }

    private val sessions = mutableMapOf<String, Session>()
    private var watching: Job? = null

    private class Session(val root: String, val gateway: String, val job: Job)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_ALL -> {
                runtime.stopAll()
                return START_NOT_STICKY
            }
            ACTION_STOP_SHARING -> {
                runtime.display.stop()
                return START_NOT_STICKY
            }
        }
        // The runtime only starts where it is available (Android 11+ with the bridge binary).
        if (!runtime.available) {
            if (intent?.action == ACTION_SHARE) runtime.display.fail()
            stopSelf()
            return START_NOT_STICKY
        }
        createChannel()
        val share = intent?.takeIf { it.action == ACTION_SHARE }?.let(ShareRequest::from)
        // Android 14 requires the media projection foreground type before the projection is created.
        if (!enterForeground(projecting = share != null || runtime.display.status.value.sharedWith != null)) {
            if (share != null) runtime.display.fail()
            stopSelf()
            return START_NOT_STICKY
        }
        if (share != null) startSharing(share)
        if (watching == null) {
            watching = scope.launch(Dispatchers.Main.immediate) { runtime.enabled.collect(::reconcile) }
            scope.launch {
                combine(runtime.instances, runtime.display.status) { instances, display -> instances to display }
                    .collect { (instances, display) -> showNotification(instances, display) }
            }
            // Drop the media projection type once sharing ends, keeping the folders connected.
            scope.launch(Dispatchers.Main.immediate) {
                runtime.display.status.map { it.sharedWith != null }.distinctUntilChanged().drop(1)
                    .collect { projecting -> if (!projecting) enterForeground(projecting = false) }
            }
        }
        // Tokens come from the running app, so a process the system restarts without it could not
        // connect. The app reconnects folders the user never disconnected when it next opens.
        return START_NOT_STICKY
    }

    private fun enterForeground(projecting: Boolean): Boolean = try {
        val projection = if (projecting && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
        val types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or projection
        } else {
            projection
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(runtime.instances.value, runtime.display.status.value), types)
        true
    } catch (error: RuntimeException) {
        Log.w(TAG, "Runtime could not enter the foreground", error)
        false
    }

    private fun startSharing(share: ShareRequest) {
        val display = runtime.display
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return display.fail()
        val projection = if (runtime.serving(share.spaceId)) {
            runCatching { getSystemService(MediaProjectionManager::class.java).getMediaProjection(share.resultCode, share.data) }
                .onFailure { Log.w(TAG, "Screen capture was not granted", it) }
                .getOrNull()
        } else {
            null
        }
        if (projection == null) {
            display.fail()
            enterForeground(projecting = display.status.value.sharedWith != null)
            return
        }
        display.start(projection, share.spaceId)
    }

    private class ShareRequest(val spaceId: String, val resultCode: Int, val data: Intent) {
        companion object {
            fun from(intent: Intent): ShareRequest? {
                val spaceId = intent.getStringExtra(EXTRA_SPACE_ID) ?: return null
                val data = IntentCompat.getParcelableExtra(intent, EXTRA_DATA, Intent::class.java) ?: return null
                return ShareRequest(spaceId, intent.getIntExtra(EXTRA_RESULT_CODE, 0), data)
            }
        }
    }

    override fun onDestroy() {
        runtime.display.stop()
        scope.cancel()
        runtime.clearLive()
        super.onDestroy()
    }

    private fun reconcile(wanted: List<Binding>) {
        val gateway = runtime.gatewayOrigin
        runtime.display.status.value.sharedWith?.let { shared -> if (wanted.none { it.spaceId == shared }) runtime.display.stop() }
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
        val home = File(filesDir, "cohub-runtime/$spaceId")
        // A Unix socket path is capped at 108 bytes, and this package name is long:
        // /data/user/<n>/io.github.markbang.cohubmobile/files/ds/<32 hex>.sock stays near 92.
        val displaySocket = File(filesDir, "ds/${spaceId.replace("-", "")}.sock")
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
            home = home,
            spaceId = spaceId,
            relayUrl = "$gateway/sandbox/relay",
            runtimeId = runtimeId,
            displaySocket = displaySocket,
            token = { tokens.get(false) },
        )
        runtime.publish(spaceId, RuntimeInstance.State.CONNECTING)
        val reporter = launch {
            combine(connection.ready, bridge.connected) { ready, connected -> ready && connected }
                .collect { ready ->
                    runtime.publish(spaceId, if (ready) RuntimeInstance.State.READY else RuntimeInstance.State.CONNECTING)
                }
        }
        // sandboxd serves this Space's displays from this socket; it lists none until the screen is shared.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) launchDisplayProvider(spaceId, displaySocket, runtime.display)
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

    private fun showNotification(instances: List<RuntimeInstance>, display: DisplayStatus) {
        if (instances.none { it.running }) return
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(instances, display))
    }

    private fun notification(instances: List<RuntimeInstance>, display: DisplayStatus): Notification {
        val ready = instances.count { it.state == RuntimeInstance.State.READY }
        val sharing = display.sharedWith != null
        val text = when {
            sharing && display.control -> getString(R.string.cohub_display_sharing_control)
            sharing -> getString(R.string.cohub_display_sharing)
            ready > 0 -> resources.getQuantityString(R.plurals.cohub_runtime_ready, ready, ready)
            else -> getString(R.string.cohub_runtime_connecting)
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.cohub_runtime_notification)
            .setContentTitle(getString(R.string.cohub_runtime_title))
            .setContentText(text)
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
        }
        if (sharing) {
            val stopSharing = PendingIntent.getService(
                this, 2, Intent(this, RuntimeService::class.java).setAction(ACTION_STOP_SHARING), PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(0, getString(R.string.cohub_display_stop), stopSharing)
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

    companion object {
        private const val CHANNEL_ID = "cohub-runtime"
        private const val NOTIFICATION_ID = 0x0C0B
        private const val ACTION_STOP_ALL = "io.github.markbang.cohubmobile.deviceruntime.STOP_ALL"
        private const val ACTION_SHARE = "io.github.markbang.cohubmobile.deviceruntime.SHARE"
        private const val ACTION_STOP_SHARING = "io.github.markbang.cohubmobile.deviceruntime.STOP_SHARING"
        private const val EXTRA_SPACE_ID = "spaceId"
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_DATA = "data"

        /** Hands a granted screen capture to the service, which starts sharing with [spaceId]. */
        fun share(context: Context, spaceId: String, resultCode: Int, data: Intent) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, RuntimeService::class.java)
                    .setAction(ACTION_SHARE)
                    .putExtra(EXTRA_SPACE_ID, spaceId)
                    .putExtra(EXTRA_RESULT_CODE, resultCode)
                    .putExtra(EXTRA_DATA, data),
            )
        }
    }
}
