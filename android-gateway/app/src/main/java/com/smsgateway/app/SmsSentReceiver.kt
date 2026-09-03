package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import kotlin.concurrent.thread

class SmsSentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val recipientId = intent.getStringExtra(SmsSender.EXTRA_RECIPIENT) ?: return
        val formatIndex = intent.getIntExtra(SmsSender.EXTRA_FORMAT_INDEX, 0)
        val partCount = intent.getIntExtra(SmsSender.EXTRA_PART_COUNT, 1)
        val ok = SmsSender.isAcceptedByRadio(resultCode)
        val batch = SmsSender.notePartResult(recipientId, formatIndex, partCount, ok)
        if (!batch.complete) return

        if (batch.success) {
            finishSuccess(context, intent, recipientId)
            return
        }

        val phone = intent.getStringExtra(SmsSender.EXTRA_PHONE).orEmpty()
        val message = intent.getStringExtra(SmsSender.EXTRA_MESSAGE).orEmpty()
        val simSlot = intent.getIntExtra(SmsSender.EXTRA_SIM_SLOT, 1)
        val candidates = SmsSender.destinationCandidates(phone)

        if (SmsSender.isRetryableRadioError(resultCode) && formatIndex + 1 < candidates.size) {
            Handler(Looper.getMainLooper()).post {
                runCatching {
                    SmsSender.send(context, phone, message, recipientId, simSlot, formatIndex + 1)
                }.onFailure { err ->
                    JobGuard.complete(recipientId)
                    StatusStore.lastError = err.message ?: "SMS retry failed"
                    report(context, recipientId, false, "SMS_FAILED", err.message)
                }
            }
            return
        }

        if (!SmsSender.isHardRadioRefusal(resultCode)) {
            Handler(Looper.getMainLooper()).post {
                runCatching {
                    SmsSender.send(
                        context,
                        phone,
                        message,
                        recipientId,
                        simSlot,
                        formatIndex,
                        withStatusIntents = false,
                    )
                    persistSent(context, intent)
                    relabelFailedAsSent(context, intent)
                }
                JobGuard.complete(recipientId)
                StatusStore.lastError = "Accusé radio $resultCode — nouvel essai"
                report(context, recipientId, false, "SMS_FAILED", "sent resultCode=$resultCode")
            }
            return
        }

        JobGuard.complete(recipientId)
        val prefs = Prefs(context)
        prefs.errors = prefs.errors + 1
        val code = if (resultCode == SmsSender.RESULT_ERROR_LIMIT_EXCEEDED) "RATE_LIMIT" else "NO_SIM"
        StatusStore.lastError = "SMS refusée (resultCode=$resultCode). Copier-coller dans Messages marche, l’envoi auto a échoué."
        report(context, recipientId, false, code, "sent resultCode=$resultCode")
    }

    private fun finishSuccess(context: Context, intent: Intent, recipientId: String) {
        JobGuard.complete(recipientId)
        Prefs(context).markSent(recipientId)
        persistSent(context, intent)
        relabelFailedAsSent(context, intent)
        StatusStore.lastError = ""
        report(context, recipientId, true, null, null)
    }

    private fun persistSent(context: Context, intent: Intent) {
        val dest = intent.getStringExtra(SmsSender.EXTRA_PHONE) ?: return
        val body = intent.getStringExtra(SmsSender.EXTRA_MESSAGE) ?: return
        runCatching {
            val values = ContentValues().apply {
                put("address", dest)
                put("body", body)
                put("date", System.currentTimeMillis())
                put("read", 1)
                put("type", 2)
            }
            context.contentResolver.insert(Uri.parse("content://sms/sent"), values)
        }
    }

    private fun relabelFailedAsSent(context: Context, intent: Intent) {
        val body = intent.getStringExtra(SmsSender.EXTRA_MESSAGE) ?: return
        runCatching {
            val values = ContentValues().apply { put("type", 2) }
            context.contentResolver.update(
                Uri.parse("content://sms"),
                values,
                "type=5 AND body=?",
                arrayOf(body),
            )
        }
    }

    private fun report(
        context: Context,
        recipientId: String,
        success: Boolean,
        errorCode: String?,
        errorDetail: String?,
    ) {
        val prefs = Prefs(context)
        if (success) prefs.messagesToday = prefs.messagesToday + 1
        thread {
            runCatching {
                GatewayClient(prefs).smsResult(recipientId, success, errorCode, errorDetail, "sent")
            }
        }
    }
}
