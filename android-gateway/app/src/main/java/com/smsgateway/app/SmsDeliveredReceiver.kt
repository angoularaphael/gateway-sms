package com.smsgateway.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class SmsDeliveredReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        runCatching {
            if (resultCode != Activity.RESULT_OK) return
            val recipientId = intent.getStringExtra(SmsSender.EXTRA_RECIPIENT) ?: return
            val prefs = Prefs(context)
            AppExecutors.net.execute {
                runCatching { GatewayClient(prefs).smsResult(recipientId, true, stage = "delivered") }
            }
        }
    }
}
