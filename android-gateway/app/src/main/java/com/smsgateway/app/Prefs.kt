package com.smsgateway.app

import android.content.Context

class Prefs(context: Context) {
    private val p = context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = p.getString("serverUrl", "http://prem-eu2.bot-hosting.net:21724") ?: "http://prem-eu2.bot-hosting.net:21724"
        set(value) { p.edit().putString("serverUrl", normalizeUrl(value)).apply() }

    var deviceId: String
        get() = p.getString("deviceId", "") ?: ""
        set(value) { p.edit().putString("deviceId", value.trim()).apply() }

    var apiKey: String
        get() = p.getString("apiKey", "") ?: ""
        set(value) { p.edit().putString("apiKey", value.trim()).apply() }

    var messagesToday: Int
        get() = p.getInt("messagesToday", 0)
        set(value) { p.edit().putInt("messagesToday", value).apply() }

    var errors: Int
        get() = p.getInt("errors", 0)
        set(value) { p.edit().putInt("errors", value).apply() }

    var lastDay: String
        get() = p.getString("lastDay", "") ?: ""
        set(value) { p.edit().putString("lastDay", value).apply() }

    companion object {
        fun normalizeUrl(raw: String): String {
            var value = raw.trim().trimEnd('/')
            if (value.isBlank()) return value
            if (!value.startsWith("http://") && !value.startsWith("https://")) {
                value = "http://$value"
            }
            return value
        }
    }
}
