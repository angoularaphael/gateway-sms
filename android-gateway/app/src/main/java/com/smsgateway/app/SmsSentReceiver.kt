package com.smsgateway.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import kotlin.concurrent.thread

class SmsSentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val recipientId = intent.getStringExtra(SmsSender.EXTRA_RECIPIENT) ?: return
        val prefs = Prefs(context)
        val result = resultCode
        thread {
            val client = GatewayClient(prefs)
            if (result == Activity.RESULT_OK) {
                runCatching { client.smsResult(recipientId, true, stage = "sent") }
            } else {
                prefs.errors = prefs.errors + 1
                val code = when (result) {
                    SmsManager.RESULT_ERROR_NO_SERVICE, SmsManager.RESULT_ERROR_RADIO_OFF -> "NO_SIM"
                    SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "RATE_LIMIT"
                    else -> "SMS_FAILED"
                }
                runCatching {
                    client.smsResult(recipientId, false, code, "sent resultCode=$result", "sent")
                }
            }
        }
    }
}
