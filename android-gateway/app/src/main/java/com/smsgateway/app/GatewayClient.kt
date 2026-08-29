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

    private fun url(path: String) = "${prefs.serverUrl}$path"

    private fun request(builder: Request.Builder): String {
        val req = builder
            .header("X-API-Key", prefs.apiKey)
            .header("X-Device-Id", prefs.deviceId)
            .build()
        http.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code}: $body")
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

    fun smsResult(recipientId: String, success: Boolean, errorCode: String? = null, errorDetail: String? = null) {
        val payload = JSONObject()
            .put("recipientId", recipientId)
            .put("success", success)
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
}
