package com.smsgateway.app

import android.content.Context

class Prefs(context: Context) {
    private val p = context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = p.getString("serverUrl", "http://10.0.2.2:4000") ?: "http://10.0.2.2:4000"
        set(value) { p.edit().putString("serverUrl", value.trimEnd('/')).apply() }

    var deviceId: String
        get() = p.getString("deviceId", "") ?: ""
        set(value) { p.edit().putString("deviceId", value).apply() }

    var apiKey: String
        get() = p.getString("apiKey", "") ?: ""
        set(value) { p.edit().putString("apiKey", value).apply() }

    var messagesToday: Int
        get() = p.getInt("messagesToday", 0)
        set(value) { p.edit().putInt("messagesToday", value).apply() }

    var errors: Int
        get() = p.getInt("errors", 0)
        set(value) { p.edit().putInt("errors", value).apply() }

    var lastDay: String
        get() = p.getString("lastDay", "") ?: ""
        set(value) { p.edit().putString("lastDay", value).apply() }
}
