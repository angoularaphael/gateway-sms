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
    const val EXTRA_BARE_SEND = "bareSend"

    /** RESULT_RADIO_NOT_AVAILABLE : l’accusé radio ment souvent. */
    const val RESULT_RADIO_NOT_AVAILABLE = 124
    const val RESULT_OK = -1
    const val RESULT_ERROR_GENERIC_FAILURE = 1
    const val RESULT_ERROR_RADIO_OFF = 3
    const val RESULT_ERROR_NO_SERVICE = 4
    const val RESULT_ERROR_LIMIT_EXCEEDED = 5

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
        val safeCount = partCount.coerceAtLeast(1)
        val key = "$recipientId:$formatIndex"
        val batch = batches.getOrPut(key) { Batch(safeCount, false) }
        synchronized(batch) {
            if (!ok) batch.failed = true
            batch.left -= 1
            if (batch.left > 0) return BatchResult(complete = false, success = false)
            batches.remove(key)
            return BatchResult(complete = true, success = !batch.failed)
        }
    }

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

        val smsManager = resolveSmsManager(context, simSlot)
        val parts = try {
            smsManager.divideMessage(message)
        } catch (_: Throwable) {
            arrayListOf(message)
        }
        if (parts.isNullOrEmpty()) {
            throw IllegalArgumentException("Message SMS vide")
        }

        if (!withStatusIntents) {
            if (parts.size == 1) {
                smsManager.sendTextMessage(dest, null, parts[0], null, null)
            } else {
                smsManager.sendMultipartTextMessage(dest, null, parts, null, null)
            }
            return
        }

        val flags = pendingFlags()
        val sentIntents = ArrayList<PendingIntent>(parts.size)
        for (i in parts.indices) {
            sentIntents.add(
                PendingIntent.getBroadcast(
                    context.applicationContext,
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
            smsManager.sendTextMessage(dest, null, parts[0], sentIntents[0], null)
        } else {
            smsManager.sendMultipartTextMessage(dest, null, parts, sentIntents, null)
        }
    }

    private fun pendingFlags(): Int {
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= 31) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        return flags
    }

    private fun requestCode(recipientId: String, formatIndex: Int, partIndex: Int, stage: String): Int {
        return "$recipientId:$formatIndex:$partIndex:$stage".hashCode()
    }

    private fun resolveSmsManager(context: Context, simSlot: Int): SmsManager {
        val fallback = defaultSmsManager(context)
        return try {
            val sm = context.getSystemService(SubscriptionManager::class.java)
            val infos = sm?.activeSubscriptionInfoList.orEmpty()
            val match = infos.firstOrNull { it.simSlotIndex + 1 == simSlot } ?: infos.firstOrNull()
            if (match != null) smsManagerFor(context, match.subscriptionId) else fallback
        } catch (_: Throwable) {
            fallback
        }
    }

    private fun defaultSmsManager(context: Context): SmsManager {
        return try {
            context.getSystemService(SmsManager::class.java) ?: SmsManager.getDefault()
        } catch (_: Throwable) {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }
    }

    private fun smsManagerFor(context: Context, subscriptionId: Int): SmsManager {
        val base = defaultSmsManager(context)
        return try {
            if (Build.VERSION.SDK_INT >= 31) {
                base.createForSubscriptionId(subscriptionId)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
            }
        } catch (_: Throwable) {
            base
        }
    }
}
