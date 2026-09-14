package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (
            action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            return
        }
        val prefs = Prefs(context)
        if (prefs.deviceId.isBlank() || prefs.apiKey.isBlank()) return
        runCatching {
            ContextCompat.startForegroundService(context, Intent(context, GatewayService::class.java))
        }
    }
}
