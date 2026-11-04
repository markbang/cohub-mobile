package io.github.markbang.cohubmobile.predictiveback

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class PredictiveBackOptionsRecord : Record {
    @Field val routes: List<String> = emptyList()

    @Field val minScale: Double = 0.95

    @Field val parallax: Double = 0.1

    @Field val commitMs: Int = 180

    @Field val cancelMs: Int = 200

    @Field val popTimeoutMs: Int = 1500

    fun toOptions() =
        PredictiveBackOptions(
            routes = routes.toSet(),
            minScale = minScale.toFloat().coerceIn(0.5f, 1f),
            parallax = parallax.toFloat().coerceIn(0f, 1f),
            commitMs = commitMs.toLong().coerceIn(0L, 1000L),
            cancelMs = cancelMs.toLong().coerceIn(0L, 1000L),
            popTimeoutMs = popTimeoutMs.toLong().coerceIn(100L, 5000L),
        )
}

class PredictiveBackModule : Module() {
    override fun definition() =
        ModuleDefinition {
            Name("CohubPredictiveBack")
            Events("onBackPhase")

            OnStartObserving("onBackPhase") {
                PredictiveBack.listener = { phase, detail -> sendEvent("onBackPhase", detail + ("phase" to phase)) }
            }

            OnStopObserving("onBackPhase") {
                PredictiveBack.listener = null
            }

            OnDestroy {
                PredictiveBack.listener = null
                PredictiveBack.blocked = false
            }

            Function("configure") { options: PredictiveBackOptionsRecord ->
                PredictiveBack.options = options.toOptions()
            }

            Function("setBlocked") { blocked: Boolean ->
                PredictiveBack.blocked = blocked
            }

            Function("state") {
                mapOf(
                    "installed" to PredictiveBack.installed,
                    "animated" to PredictiveBack.animated,
                    "phase" to PredictiveBack.phase(),
                )
            }
        }
}
