package com.smsgateway.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class GatewayClient(private val prefs: Prefs) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun health(): String {
        return try {
            val req = Request.Builder().url(url("/api/health")).get().build()
            http.newCall(req).execute().use { res ->
                val body = res.body?.string().orEmpty()
                if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code}: $body")
                body
            }
        } catch (e: IllegalStateException) {
            throw e
        } catch (e: java.net.UnknownHostException) {
            throw IllegalStateException("Serveur introuvable. Vérifiez l’URL.")
        } catch (e: java.net.ConnectException) {
            throw IllegalStateException("Connexion refusée. Port 21724 bloqué ?")
        } catch (e: java.net.SocketTimeoutException) {
            throw IllegalStateException("Délai dépassé. Essayez en Wi‑Fi.")
        } catch (e: java.io.IOException) {
            throw IllegalStateException("Réseau: ${e.message}")
        }
    }

    private fun request(builder: Request.Builder): String {
        val req = builder
            .header("X-API-Key", prefs.apiKey)
            .header("X-Device-Id", prefs.deviceId)
            .build()
        http.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val msg = when (res.code) {
                    401 -> "Clé API ou Device ID incorrect"
                    404 -> "Appareil introuvable (Device ID)"
                    else -> "HTTP ${res.code}: $body"
                }
                throw IllegalStateException(msg)
            }
            return body
        }
    }

    fun heartbeat(appVersion: String, sims: JSONArray): JSONObject {
        val payload = JSONObject()
            .put("appVersion", appVersion)
            .put("sims", sims)
            .toString()
        val body = request(
            Request.Builder()
                .url(url("/api/devices/${prefs.deviceId}/heartbeat"))
                .post(payload.toRequestBody(jsonType)),
        )
        return JSONObject(body)
    }

    fun pendingJobs(): JSONArray {
        val body = request(
            Request.Builder().url(url("/api/devices/${prefs.deviceId}/pending-sms")).get(),
        )
        return JSONObject(body).optJSONArray("jobs") ?: JSONArray()
    }

    fun smsResult(
        recipientId: String,
        success: Boolean,
        errorCode: String? = null,
        errorDetail: String? = null,
        stage: String = "sent",
    ) {
        val payload = JSONObject()
            .put("recipientId", recipientId)
            .put("success", success)
            .put("stage", stage)
            .put("errorCode", errorCode ?: JSONObject.NULL)
            .put("errorDetail", errorDetail ?: JSONObject.NULL)
            .toString()
        request(
            Request.Builder()
                .url(url("/api/devices/${prefs.deviceId}/sms-result"))
                .post(payload.toRequestBody(jsonType)),
        )
    }

    fun incomingSms(from: String, bodyText: String) {
        val payload = JSONObject().put("from", from).put("body", bodyText).toString()
        request(
            Request.Builder()
                .url(url("/api/devices/${prefs.deviceId}/incoming-sms"))
                .post(payload.toRequestBody(jsonType)),
        )
    }

    private fun url(path: String): String {
        val base = prefs.serverUrl.trim().trimEnd('/')
        val p = if (path.startsWith("/")) path else "/$path"
        return "$base$p"
    }
}
