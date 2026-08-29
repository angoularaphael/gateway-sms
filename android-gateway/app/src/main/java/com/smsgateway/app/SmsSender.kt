package com.smsgateway.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.telephony.SubscriptionManager

object SmsSender {
    const val ACTION_SENT = "com.smsgateway.app.SMS_SENT"
    const val EXTRA_RECIPIENT = "recipientId"

    fun send(context: Context, phone: String, message: String, recipientId: String, simSlot: Int) {
        val sm = context.getSystemService(SubscriptionManager::class.java)
        val infos = sm?.activeSubscriptionInfoList.orEmpty()
        val match = infos.firstOrNull { it.simSlotIndex + 1 == simSlot } ?: infos.firstOrNull()
        val smsManager = if (match != null) {
            SmsManager.getSmsManagerForSubscriptionId(match.subscriptionId)
        } else {
            context.getSystemService(SmsManager::class.java) ?: SmsManager.getDefault()
        }

        val sent = PendingIntent.getBroadcast(
            context,
            recipientId.hashCode(),
            Intent(ACTION_SENT).setPackage(context.packageName).putExtra(EXTRA_RECIPIENT, recipientId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val parts = smsManager.divideMessage(message)
        if (parts.size == 1) {
            smsManager.sendTextMessage(phone, null, message, sent, null)
        } else {
            val sentIntents = ArrayList<PendingIntent>(parts.map { sent })
            smsManager.sendMultipartTextMessage(phone, null, parts, sentIntents, null)
        }
    }
}
