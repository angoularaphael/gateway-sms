package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class IncomingSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        relayIncoming(context, intent)
    }
}

class SmsDeliverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_DELIVER_ACTION) return
        relayIncoming(context, intent)
    }
}

internal fun relayIncoming(context: Context, intent: Intent) {
    runCatching {
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)?.filterNotNull().orEmpty()
        if (messages.isEmpty()) return
        val from = messages.first().originatingAddress ?: return
        val body = messages.joinToString("") { it.messageBody.orEmpty() }
        val prefs = Prefs(context)
        if (prefs.apiKey.isBlank()) return
        AppExecutors.net.execute {
            runCatching { GatewayClient(prefs).incomingSms(from, body) }
        }
    }
}
