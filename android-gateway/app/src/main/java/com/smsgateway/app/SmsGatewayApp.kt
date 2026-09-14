package com.smsgateway.app

import android.app.Application

class SmsGatewayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                getSharedPreferences("sms_gateway", MODE_PRIVATE)
                    .edit()
                    .putString(
                        "lastCrash",
                        "${error.javaClass.simpleName}: ${error.message ?: ""}".take(240),
                    )
                    .apply()
            }
            previous?.uncaughtException(thread, error)
        }
    }
}
