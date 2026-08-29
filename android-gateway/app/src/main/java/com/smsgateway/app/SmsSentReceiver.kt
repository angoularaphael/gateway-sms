package com.smsgateway.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager

class SmsSentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val recipientId = intent.getStringExtra(SmsSender.EXTRA_RECIPIENT) ?: return
        val prefs = Prefs(context)
        val client = GatewayClient(prefs)
        if (resultCode == Activity.RESULT_OK) {
            prefs.messagesToday = prefs.messagesToday + 1
            runCatching { client.smsResult(recipientId, true) }
        } else {
            prefs.errors = prefs.errors + 1
            val code = when (resultCode) {
                SmsManager.RESULT_ERROR_NO_SERVICE, SmsManager.RESULT_ERROR_RADIO_OFF -> "NO_SIM"
                else -> "SMS_FAILED"
            }
            runCatching { client.smsResult(recipientId, false, code, "resultCode=$resultCode") }
        }
    }
}
