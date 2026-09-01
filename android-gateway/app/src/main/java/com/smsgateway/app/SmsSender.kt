package com.smsgateway.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.telephony.SubscriptionManager

object SmsSender {
    const val ACTION_SENT = "com.smsgateway.app.SMS_SENT"
    const val ACTION_DELIVERED = "com.smsgateway.app.SMS_DELIVERED"
    const val EXTRA_RECIPIENT = "recipientId"
    const val EXTRA_STAGE = "stage"

    fun toNationalFr(phone: String): String {
        val digits = phone.filter { it.isDigit() }
        if (digits.startsWith("33") && digits.length == 11) {
            return "0${digits.substring(2)}"
        }
        return phone
    }

    fun send(context: Context, phone: String, message: String, recipientId: String, simSlot: Int) {
        val dest = toNationalFr(phone)
        val sm = context.getSystemService(SubscriptionManager::class.java)
        val infos = sm?.activeSubscriptionInfoList.orEmpty()
        val match = infos.firstOrNull { it.simSlotIndex + 1 == simSlot } ?: infos.firstOrNull()
        val smsManager = if (match != null) {
            SmsManager.getSmsManagerForSubscriptionId(match.subscriptionId)
        } else {
            context.getSystemService(SmsManager::class.java) ?: SmsManager.getDefault()
        }

        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        val sent = PendingIntent.getBroadcast(
            context,
            recipientId.hashCode(),
            Intent(ACTION_SENT)
                .setPackage(context.packageName)
                .putExtra(EXTRA_RECIPIENT, recipientId)
                .putExtra(EXTRA_STAGE, "sent"),
            flags,
        )
        val delivered = PendingIntent.getBroadcast(
            context,
            recipientId.hashCode() + 1,
            Intent(ACTION_DELIVERED)
                .setPackage(context.packageName)
                .putExtra(EXTRA_RECIPIENT, recipientId)
                .putExtra(EXTRA_STAGE, "delivered"),
            flags,
        )

        val parts = smsManager.divideMessage(message)
        if (parts.size == 1) {
            smsManager.sendTextMessage(dest, null, message, sent, delivered)
        } else {
            val sentIntents = ArrayList(parts.map { sent })
            val deliveredIntents = ArrayList(parts.map { delivered })
            smsManager.sendMultipartTextMessage(dest, null, parts, sentIntents, deliveredIntents)
        }
    }
}
