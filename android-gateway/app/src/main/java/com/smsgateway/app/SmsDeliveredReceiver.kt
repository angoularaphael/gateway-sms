package com.smsgateway.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

class SmsDeliveredReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val recipientId = intent.getStringExtra(SmsSender.EXTRA_RECIPIENT) ?: return
        val prefs = Prefs(context)
        thread {
            val client = GatewayClient(prefs)
            if (resultCode == Activity.RESULT_OK) {
                runCatching { client.smsResult(recipientId, true, stage = "delivered") }
            } else {
                runCatching {
                    client.smsResult(
                        recipientId,
                        false,
                        "SMS_FAILED",
                        "delivery resultCode=$resultCode",
                        "delivered",
                    )
                }
            }
        }
    }
}
