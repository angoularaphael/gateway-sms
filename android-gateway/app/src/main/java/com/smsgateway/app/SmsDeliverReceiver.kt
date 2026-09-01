package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import kotlin.concurrent.thread

/** Requis pour être l’appli SMS par défaut (évite le popup « trop de SMS »). */
class SmsDeliverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_DELIVER_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        val from = messages.firstOrNull()?.originatingAddress ?: return
        val body = messages.joinToString("") { it.messageBody ?: "" }
        val prefs = Prefs(context)
        if (prefs.apiKey.isBlank()) return
        thread {
            runCatching { GatewayClient(prefs).incomingSms(from, body) }
        }
    }
}
