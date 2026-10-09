package io.github.markbang.cohubmobile.deviceruntime

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class RuntimeInstance(
    val spaceId: String,
    val root: String,
    val label: String,
    val state: State,
    val error: String? = null,
) {
    enum class State(val wire: String) { STOPPED("stopped"), CONNECTING("connecting"), READY("ready"), ERROR("error") }

    val running: Boolean get() = state == State.CONNECTING || state == State.READY

    fun toMap(): Map<String, Any?> = mapOf(
        "spaceId" to spaceId,
        "root" to root,
        "label" to label,
        "state" to state.wire,
        "error" to error,
    )
}

data class FolderListing(
    val path: String,
    val label: String,
    val parent: String?,
    val spaceId: String?,
    val folders: List<File>,
    val volumes: List<Pair<File, String>>,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "path" to path,
        "label" to label,
        "parent" to parent,
        "spaceId" to spaceId,
        "folders" to folders.map { mapOf("name" to it.name, "path" to it.path) },
        "volumes" to volumes.map { (dir, label) -> mapOf("path" to dir.path, "label" to label) },
    )
}

class FolderUnavailable(path: String) : Exception("Folder unavailable: $path")

internal data class Binding(val account: String, val root: String, val spaceId: String, val enabled: Boolean) {
    fun toJson(): JSONObject = JSONObject()
        .put("account", account)
        .put("root", root)
        .put("spaceId", spaceId)
        .put("enabled", enabled)

    companion object {
        fun fromJson(json: JSONObject) = Binding(
            account = json.getString("account"),
            root = json.getString("root"),
            spaceId = json.getString("spaceId"),
            enabled = json.getBoolean("enabled"),
        )
    }
}

/** Binds one folder to one Space per account, like `cohub runtime up`; a running folder or Space is never taken over. */
internal fun List<Binding>.bind(owner: String, spaceId: String, root: String, running: Set<String>): Pair<List<Binding>, String?> {
    val folder = firstOrNull { it.account == owner && it.root == root }
    val space = firstOrNull { it.account == owner && it.spaceId == spaceId }
    if (folder != null && folder.spaceId in running && folder.spaceId != spaceId) return this to REFUSED_FOLDER_IN_USE
    if (space != null && space.spaceId in running && space.root != root) return this to REFUSED_SPACE_IN_USE
    return (this - setOfNotNull(folder, space) + Binding(owner, root, spaceId, enabled = true)) to null
}

internal const val REFUSED_FOLDER_IN_USE = "folder_in_use"
internal const val REFUSED_SPACE_IN_USE = "space_in_use"
internal const val REFUSED_FOLDER_UNAVAILABLE = "folder_unavailable"

/**
 * The device folders this app serves as local Runtimes. Bindings persist per account;
 * only the signed-in account's enabled bindings run, all in one foreground service.
 */
class DeviceRuntime private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val lock = Any()
    private var bindings: List<Binding> = load()
    private val live = mutableMapOf<String, Pair<RuntimeInstance.State, String?>>()
    private var account: String? = null
    private val snapshot = MutableStateFlow<List<RuntimeInstance>>(emptyList())
    private val enabledBindings = MutableStateFlow<List<Binding>>(emptyList())

    val tokens = AccessTokens()

    /** Gateway origin (`wss://host`) of the signed-in environment. */
    @Volatile
    var gatewayOrigin: String? = null
        private set

    val instances: StateFlow<List<RuntimeInstance>> = snapshot.asStateFlow()

    internal val enabled: StateFlow<List<Binding>> = enabledBindings.asStateFlow()

    val available: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && bridgeBinary.canExecute()

    val bridgeBinary: File
        get() = File(context.applicationInfo.nativeLibraryDir, "libcohub_sandboxd.so")

    fun hasStorageAccess(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()

    fun configure(account: String, gatewayOrigin: String) {
        synchronized(lock) {
            if (this.account != account || this.gatewayOrigin != gatewayOrigin) tokens.clear()
            this.account = account
            this.gatewayOrigin = gatewayOrigin
            recompute()
        }
    }

    /** Sign-out disconnects every folder; they stay bound and can be reconnected after signing in. */
    fun signOut() {
        synchronized(lock) {
            account = null
            gatewayOrigin = null
            tokens.clear()
            bindings = bindings.map { it.copy(enabled = false) }
            live.clear()
            save()
        }
    }

    suspend fun browse(path: String?): FolderListing = withContext(Dispatchers.IO) {
        val volumes = volumes()
        val dir = File(path ?: volumes.firstOrNull()?.first?.path ?: throw FolderUnavailable("")).canonicalFile
        val volume = volumes.firstOrNull { within(it.first, dir) } ?: throw FolderUnavailable(dir.path)
        if (!usable(dir, volume.first)) throw FolderUnavailable(dir.path)
        val folders = dir.listFiles { child -> child.isDirectory && usable(child, volume.first) }.orEmpty()
            .sortedBy { it.name.lowercase() }
            .take(MAX_FOLDERS)
        val spaceId = synchronized(lock) { bindingsFor(account).firstOrNull { it.root == dir.path }?.spaceId }
        FolderListing(
            path = dir.path,
            label = label(dir, volumes),
            parent = dir.parentFile?.takeIf { dir != volume.first }?.path,
            spaceId = spaceId,
            folders = folders,
            volumes = volumes,
        )
    }

    /** Binds and connects [root] for [spaceId]; returns a refusal code instead when it cannot. */
    suspend fun start(spaceId: String, root: String): String? = withContext(Dispatchers.IO) {
        check(available) { "This device cannot serve a Space" }
        val volumes = volumes()
        val dir = File(root).canonicalFile
        val volume = volumes.firstOrNull { within(it.first, dir) }
        if (volume == null || !usable(dir, volume.first)) return@withContext REFUSED_FOLDER_UNAVAILABLE
        synchronized(lock) {
            val owner = account ?: throw IllegalStateException("Sign in to connect this device")
            val running = live.filterValues { (state) -> state == RuntimeInstance.State.CONNECTING || state == RuntimeInstance.State.READY }.keys
            val (next, refused) = bindings.bind(owner, spaceId, dir.path, running)
            if (refused != null) return@withContext refused
            if (next != bindings) {
                bindings = next
                live.remove(spaceId)
                save()
            }
        }
        launchService()
        null
    }

    /** Reconnects folders the user never disconnected, e.g. after the process was killed. */
    fun resume() {
        val wanted = synchronized(lock) { account != null && enabledBindings.value.isNotEmpty() }
        if (wanted && available && hasStorageAccess()) launchService()
    }

    fun stop(spaceId: String) {
        synchronized(lock) {
            val owner = account
            bindings = bindings.map { if (it.account == owner && it.spaceId == spaceId) it.copy(enabled = false) else it }
            live.remove(spaceId)
            save()
        }
    }

    fun stopAll() {
        synchronized(lock) {
            bindings = bindings.map { it.copy(enabled = false) }
            live.clear()
            save()
        }
    }

    internal fun publish(spaceId: String, state: RuntimeInstance.State) {
        synchronized(lock) {
            if (bindingsFor(account).none { it.spaceId == spaceId && it.enabled }) return
            live[spaceId] = state to null
            refresh()
        }
    }

    internal fun fail(spaceId: String, code: String) {
        synchronized(lock) {
            val owner = account
            bindings = bindings.map { if (it.account == owner && it.spaceId == spaceId) it.copy(enabled = false) else it }
            live[spaceId] = RuntimeInstance.State.ERROR to code
            save()
        }
    }

    internal fun clearLive() {
        synchronized(lock) {
            live.entries.removeAll { it.value.first != RuntimeInstance.State.ERROR }
            refresh()
        }
    }

    private fun label(dir: File, volumes: List<Pair<File, String>>): String {
        val volume = volumes.firstOrNull { within(it.first, dir) } ?: return dir.path
        val relative = dir.relativeTo(volume.first).path
        return if (relative.isEmpty()) volume.second else "${volume.second}/$relative"
    }

    private fun launchService() {
        ContextCompat.startForegroundService(context, Intent(context, RuntimeService::class.java))
    }

    private fun bindingsFor(owner: String?): List<Binding> = if (owner == null) emptyList() else bindings.filter { it.account == owner }

    private fun instancesFor(owner: String?): List<RuntimeInstance> {
        val volumes = volumes()
        return bindingsFor(owner).map { binding ->
            val (state, error) = live[binding.spaceId] ?: (RuntimeInstance.State.STOPPED to null)
            RuntimeInstance(binding.spaceId, binding.root, label(File(binding.root), volumes), state, error)
        }
    }

    private fun refresh() {
        snapshot.value = instancesFor(account)
    }

    private fun recompute() {
        enabledBindings.value = bindingsFor(account).filter { it.enabled }
        refresh()
    }

    private fun save() {
        val json = JSONArray().apply { bindings.forEach { put(it.toJson()) } }
        prefs.edit { putString(KEY_BINDINGS, json.toString()) }
        recompute()
    }

    private fun load(): List<Binding> {
        val stored = prefs.getString(KEY_BINDINGS, null) ?: return emptyList()
        val json = JSONArray(stored)
        return (0 until json.length()).map { Binding.fromJson(json.getJSONObject(it)) }
    }

    private fun volumes(): List<Pair<File, String>> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
        return context.getSystemService(StorageManager::class.java).storageVolumes
            .filter { it.state == Environment.MEDIA_MOUNTED }
            .mapNotNull { volume -> volume.directory?.let { it.canonicalFile to volume.getDescription(context) } }
    }

    private fun within(root: File, dir: File): Boolean = dir == root || dir.path.startsWith(root.path + File.separator)

    // Android keeps other apps' Android/data and Android/obb private, so they are never offered.
    private fun usable(dir: File, volume: File): Boolean =
        dir.canRead() && PRIVATE.none { within(File(volume, it), dir) }

    companion object {
        private const val PREFS = "cohub-device-runtime"
        private const val KEY_BINDINGS = "bindings"
        private const val MAX_FOLDERS = 10_000
        private val PRIVATE = listOf("Android/data", "Android/obb")

        @Volatile
        private var instance: DeviceRuntime? = null

        fun get(context: Context): DeviceRuntime =
            instance ?: synchronized(this) { instance ?: DeviceRuntime(context.applicationContext).also { instance = it } }
    }
}
