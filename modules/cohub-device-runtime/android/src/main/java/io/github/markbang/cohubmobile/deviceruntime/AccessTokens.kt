package io.github.markbang.cohubmobile.deviceruntime

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException

/**
 * Access tokens for the Runtime connections. Sign-in lives in the app's JavaScript (Logto),
 * so the service asks the running app for a token and caches it until shortly before it
 * expires. Concurrent requests share one round trip.
 */
class AccessTokens(private val clock: () -> Long = System::currentTimeMillis) {
    private val lock = Any()
    private var token: String? = null
    private var expiresAt = 0L
    private var pending: CompletableDeferred<String?>? = null

    /** Asks the app for a token; null while no app instance is attached. */
    @Volatile
    var requester: ((forceRefresh: Boolean) -> Unit)? = null

    fun supply(token: String?, expiresAt: Long) {
        val waiter = synchronized(lock) {
            this.token = token
            this.expiresAt = expiresAt
            pending.also { pending = null }
        }
        waiter?.complete(token)
    }

    fun clear() = supply(null, 0)

    suspend fun get(forceRefresh: Boolean): String {
        var request = false
        val waiter = synchronized(lock) {
            val current = token
            if (!forceRefresh && current != null && expiresAt - clock() > REFRESH_MARGIN_MS) return current
            pending ?: CompletableDeferred<String?>().also {
                pending = it
                request = true
            }
        }
        if (request) {
            val ask = requester
            if (ask == null) {
                abandon(waiter)
                throw IOException("Open Cohub to reconnect this device")
            }
            ask(forceRefresh)
        }
        val next = withTimeoutOrNull(REQUEST_TIMEOUT_MS) { waiter.await() }
        if (next == null) {
            abandon(waiter)
            throw IOException("No access token is available")
        }
        return next
    }

    private fun abandon(waiter: CompletableDeferred<String?>) {
        synchronized(lock) { if (pending === waiter) pending = null }
        waiter.complete(null)
    }

    private companion object {
        // Matches DEVICE_RUNTIME_TOKEN_MARGIN_MS in src/data/device-runtime.ts.
        const val REFRESH_MARGIN_MS = 120_000L
        const val REQUEST_TIMEOUT_MS = 20_000L
    }
}
