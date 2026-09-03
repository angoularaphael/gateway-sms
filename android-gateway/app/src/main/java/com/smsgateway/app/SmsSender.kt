package com.smsgateway.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import java.util.concurrent.ConcurrentHashMap

object SmsSender {
    const val ACTION_SENT = "com.smsgateway.app.SMS_SENT"
    const val ACTION_DELIVERED = "com.smsgateway.app.SMS_DELIVERED"
    const val EXTRA_RECIPIENT = "recipientId"
    const val EXTRA_STAGE = "stage"
    const val EXTRA_PHONE = "phone"
    const val EXTRA_MESSAGE = "message"
    const val EXTRA_SIM_SLOT = "simSlot"
    const val EXTRA_FORMAT_INDEX = "formatIndex"
    const val EXTRA_PART_INDEX = "partIndex"
    const val EXTRA_PART_COUNT = "partCount"

    private data class Batch(var left: Int, var failed: Boolean)

    private val batches = ConcurrentHashMap<String, Batch>()

    data class BatchResult(val complete: Boolean, val success: Boolean)

    fun toNationalFr(phone: String): String {
        val digits = phone.filter { it.isDigit() }
        if (digits.startsWith("33") && digits.length == 11) {
            return "0${digits.substring(2)}"
        }
        return phone
    }

    fun toE164Fr(phone: String): String {
        val digits = phone.filter { it.isDigit() }
        if (digits.startsWith("33") && digits.length == 11) return "+$digits"
        if (digits.startsWith("0") && digits.length == 10) return "+33${digits.substring(1)}"
        if (phone.trim().startsWith("+")) return phone.trim()
        return phone
    }

    fun destinationCandidates(phone: String): List<String> {
        val raw = phone.trim()
        if (raw.isEmpty()) return emptyList()
        return linkedSetOf(toNationalFr(raw), toE164Fr(raw), raw).filter { it.isNotBlank() }
    }

    fun notePartResult(recipientId: String, formatIndex: Int, partCount: Int, ok: Boolean): BatchResult {
        val key = "$recipientId:$formatIndex"
        val batch = batches.getOrPut(key) { Batch(partCount, false) }
        synchronized(batch) {
            if (!ok) batch.failed = true
            batch.left -= 1
            if (batch.left > 0) return BatchResult(complete = false, success = false)
            batches.remove(key)
            return BatchResult(complete = true, success = !batch.failed)
        }
    }

    const val EXTRA_BARE_SEND = "bareSend"

    /** RESULT_RADIO_NOT_AVAILABLE : l’accusé radio ment souvent. */
    const val RESULT_RADIO_NOT_AVAILABLE = 124
    const val RESULT_OK = -1
    const val RESULT_ERROR_GENERIC_FAILURE = 1
    const val RESULT_ERROR_RADIO_OFF = 3
    const val RESULT_ERROR_NO_SERVICE = 4
    const val RESULT_ERROR_LIMIT_EXCEEDED = 5

    fun isAcceptedByRadio(resultCode: Int): Boolean {
        return resultCode == RESULT_OK
    }

    fun isHardRadioRefusal(resultCode: Int): Boolean {
        return resultCode == RESULT_ERROR_LIMIT_EXCEEDED ||
            resultCode == RESULT_ERROR_NO_SERVICE ||
            resultCode == RESULT_ERROR_RADIO_OFF
    }

    fun isRetryableRadioError(resultCode: Int): Boolean {
        if (isAcceptedByRadio(resultCode) || isHardRadioRefusal(resultCode)) return false
        return resultCode != RESULT_RADIO_NOT_AVAILABLE
    }

    fun send(
        context: Context,
        phone: String,
        message: String,
        recipientId: String,
        simSlot: Int,
        formatIndex: Int = 0,
        withStatusIntents: Boolean = true,
    ) {
        val candidates = destinationCandidates(phone)
        val dest = candidates.getOrNull(formatIndex) ?: candidates.firstOrNull() ?: phone
        if (dest.isBlank() || message.isBlank()) {
            throw IllegalArgumentException("Numéro ou message vide")
        }

        val sm = context.getSystemService(SubscriptionManager::class.java)
        val infos = sm?.activeSubscriptionInfoList.orEmpty()
        val match = infos.firstOrNull { it.simSlotIndex + 1 == simSlot } ?: infos.firstOrNull()
        val smsManager = if (match != null) {
            smsManagerFor(context, match.subscriptionId)
        } else {
            context.getSystemService(SmsManager::class.java) ?: SmsManager.getDefault()
        }

        val parts = smsManager.divideMessage(message)
        if (!withStatusIntents) {
            if (parts.size == 1) {
                smsManager.sendTextMessage(dest, null, message, null, null)
            } else {
                smsManager.sendMultipartTextMessage(dest, null, parts, null, null)
            }
            return
        }

        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        val sentIntents = ArrayList<PendingIntent>(parts.size)
        for (i in parts.indices) {
            sentIntents.add(
                PendingIntent.getBroadcast(
                    context,
                    requestCode(recipientId, formatIndex, i, "sent"),
                    Intent(ACTION_SENT)
                        .setPackage(context.packageName)
                        .putExtra(EXTRA_RECIPIENT, recipientId)
                        .putExtra(EXTRA_STAGE, "sent")
                        .putExtra(EXTRA_PHONE, phone)
                        .putExtra(EXTRA_MESSAGE, message)
                        .putExtra(EXTRA_SIM_SLOT, simSlot)
                        .putExtra(EXTRA_FORMAT_INDEX, formatIndex)
                        .putExtra(EXTRA_PART_INDEX, i)
                        .putExtra(EXTRA_PART_COUNT, parts.size)
                        .putExtra(EXTRA_BARE_SEND, false),
                    flags,
                ),
            )
        }

        if (parts.size == 1) {
            smsManager.sendTextMessage(dest, null, message, sentIntents[0], null)
        } else {
            smsManager.sendMultipartTextMessage(dest, null, parts, sentIntents, null)
        }
    }

    private fun requestCode(recipientId: String, formatIndex: Int, partIndex: Int, stage: String): Int {
        return "$recipientId:$formatIndex:$partIndex:$stage".hashCode()
    }

    private fun smsManagerFor(context: Context, subscriptionId: Int): SmsManager {
        val base = context.getSystemService(SmsManager::class.java) ?: SmsManager.getDefault()
        return if (Build.VERSION.SDK_INT >= 31) {
            base.createForSubscriptionId(subscriptionId)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
        }
    }
}
