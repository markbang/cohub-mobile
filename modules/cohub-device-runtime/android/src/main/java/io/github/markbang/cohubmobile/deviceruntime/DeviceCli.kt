package io.github.markbang.cohubmobile.deviceruntime

import android.content.Context
import android.system.Os
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream

/** What to download: Node for Android arm64 (gzip) and the CLI's installed node_modules (zip), each pinned by SHA-256. */
data class CliManifest(val version: String, val nodeUrl: String, val nodeSha256: String, val cliUrl: String, val cliSha256: String)

data class CliState(val status: Status, val version: String? = null, val progress: Double? = null, val error: String? = null) {
    enum class Status(val wire: String) { UNSUPPORTED("unsupported"), ABSENT("absent"), INSTALLING("installing"), READY("ready") }

    fun toMap(): Map<String, Any?> = mapOf("status" to status.wire, "version" to version, "progress" to progress, "error" to error)
}

private class CliFailure(val code: String, message: String) : IOException(message)

/**
 * `cohub` and `node` for what a Runtime runs, downloaded on demand instead of carried in the APK. The
 * APK carries only the launcher; the files it runs live under no-backup storage, one version at a time.
 */
class DeviceCli(private val context: Context, private val http: OkHttpClient) {
    private val root = File(context.noBackupFilesDir, "cohub-cli")
    private val bin = File(root, "bin")
    private val current = File(root, "current")
    private val launcher = File(context.applicationInfo.nativeLibraryDir, LAUNCHER)
    private val lock = Mutex()
    private val _state = MutableStateFlow(read())

    val state: StateFlow<CliState> = _state.asStateFlow()

    /** Only arm64 APKs carry the launcher, as Node is built for arm64 alone. */
    val supported: Boolean get() = launcher.canExecute()

    private fun read(): CliState = when {
        !supported -> CliState(CliState.Status.UNSUPPORTED)
        else -> installedVersion()?.let { CliState(CliState.Status.READY, it) } ?: CliState(CliState.Status.ABSENT)
    }

    private fun installedVersion(): String? =
        runCatching { File(current, VERSION_FILE).readText().trim() }.getOrNull()
            ?.takeIf { File(current, "node").isFile && File(current, ENTRY).isFile }

    /**
     * The directory to put on PATH, or null where the APK carries no launcher. Links are remade on every
     * call: an app update moves nativeLibraryDir, leaving the old links dangling.
     */
    @Synchronized
    fun bin(): File? {
        if (!supported) return null
        bin.mkdirs()
        for (name in COMMANDS) {
            val link = File(bin, name)
            if (runCatching { Os.readlink(link.path) }.getOrNull() == launcher.path) continue
            link.delete()
            Os.symlink(launcher.path, link.path)
        }
        return bin
    }

    suspend fun install(manifest: CliManifest): CliState = lock.withLock {
        if (!supported) return@withLock _state.value
        if (installedVersion() == manifest.version) return@withLock CliState(CliState.Status.READY, manifest.version).also { _state.value = it }
        _state.value = CliState(CliState.Status.INSTALLING, installedVersion(), 0.0)
        val staging = File(root, "staging")
        val next = try {
            withContext(Dispatchers.IO) { stage(manifest, staging) }
            CliState(CliState.Status.READY, manifest.version)
        } catch (error: CancellationException) {
            staging.deleteRecursively()
            _state.value = read()
            throw error
        } catch (error: Exception) {
            Log.w(TAG, "The Cohub CLI could not be installed", error)
            staging.deleteRecursively()
            read().copy(error = (error as? CliFailure)?.code ?: if (error is IOException) "download_failed" else "failed")
        }
        next.also { _state.value = it }
    }

    suspend fun remove(): CliState = lock.withLock {
        withContext(Dispatchers.IO) {
            current.delete()
            File(root, "versions").deleteRecursively()
        }
        read().also { _state.value = it }
    }

    private suspend fun stage(manifest: CliManifest, staging: File) {
        staging.deleteRecursively()
        staging.mkdirs()
        val nodeGz = File(staging, "node.gz")
        fetch(manifest.nodeUrl, manifest.nodeSha256, nodeGz, 0.0, NODE_SHARE)
        GZIPInputStream(nodeGz.inputStream()).use { input -> File(staging, "node").outputStream().use { input.copyTo(it) } }
        nodeGz.delete()
        val cliZip = File(staging, "cli.zip")
        fetch(manifest.cliUrl, manifest.cliSha256, cliZip, NODE_SHARE, 1 - NODE_SHARE)
        unzip(cliZip, File(staging, "cli"))
        cliZip.delete()
        if (!File(staging, ENTRY).isFile) throw CliFailure("invalid_package", "The CLI package has no $ENTRY")
        File(staging, VERSION_FILE).writeText(manifest.version)

        val versions = File(root, "versions").apply { mkdirs() }
        val target = File(versions, manifest.version)
        target.deleteRecursively()
        if (!staging.renameTo(target)) throw IOException("Could not move the CLI into place")
        // Swapping the link is atomic, so a running `cohub` never sees half a version.
        val swap = File(root, "current.next")
        swap.delete()
        Os.symlink(target.path, swap.path)
        Os.rename(swap.path, current.path)
        versions.listFiles()?.filter { it.name != manifest.version }?.forEach { it.deleteRecursively() }
        bin()
    }

    private suspend fun fetch(url: String, sha256: String, into: File, from: Double, share: Double) {
        val digest = MessageDigest.getInstance("SHA-256")
        http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) throw CliFailure("download_failed", "HTTP ${response.code} for $url")
            val body = response.body ?: throw CliFailure("download_failed", "No body for $url")
            val total = body.contentLength()
            var done = 0L
            var reported = -1
            body.byteStream().use { input ->
                into.outputStream().use { output ->
                    val buffer = ByteArray(BUFFER)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val read = input.read(buffer)
                        if (read < 0) break
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                        done += read
                        if (total > 0) {
                            val percent = ((from + share * done / total) * 100).toInt()
                            if (percent != reported) {
                                reported = percent
                                _state.value = _state.value.copy(progress = percent / 100.0)
                            }
                        }
                    }
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (!actual.equals(sha256, ignoreCase = true)) throw CliFailure("checksum_mismatch", "SHA-256 of $url is $actual")
    }

    private fun unzip(zip: File, into: File) {
        val base = into.canonicalPath + File.separator
        ZipInputStream(zip.inputStream()).use { input ->
            generateSequence { input.nextEntry }.filterNot { it.isDirectory }.forEach { entry ->
                val target = File(into, entry.name).canonicalFile
                if (!target.path.startsWith(base)) throw CliFailure("invalid_package", "Bad entry ${entry.name}")
                target.parentFile?.mkdirs()
                target.outputStream().use { input.copyTo(it) }
            }
        }
    }

    private companion object {
        const val TAG = "CohubCli"
        const val LAUNCHER = "libcohub_cli.so"
        const val VERSION_FILE = "version"
        const val ENTRY = "cli/node_modules/@neta-art/cohub-cli/bin/cohub.js"
        const val BUFFER = 64 * 1024
        // Node is about two thirds of the download.
        const val NODE_SHARE = 0.67
        val COMMANDS = listOf("cohub", "node")
    }
}
