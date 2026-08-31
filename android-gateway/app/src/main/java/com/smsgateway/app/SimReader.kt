package com.smsgateway.app

import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject

data class SimInfo(val slot: Int, val phoneNumber: String?, val status: String, val subscriptionId: Int)

object SimReader {
    fun read(tm: TelephonyManager, sm: SubscriptionManager?): List<SimInfo> {
        return try {
            val infos = sm?.activeSubscriptionInfoList.orEmpty()
            if (infos.isEmpty()) {
                return listOf(SimInfo(1, null, "ABSENT", -1), SimInfo(2, null, "ABSENT", -1))
            }
            infos.map { info ->
                val slot = info.simSlotIndex + 1
                val number = info.number?.takeIf { it.isNotBlank() }
                val ready = info.simSlotIndex >= 0
                SimInfo(
                    slot = slot,
                    phoneNumber = number,
                    status = if (ready) "READY" else "UNKNOWN",
                    subscriptionId = info.subscriptionId,
                )
            }
        } catch (_: SecurityException) {
            listOf(SimInfo(1, null, "UNKNOWN", -1), SimInfo(2, null, "UNKNOWN", -1))
        }
    }

    fun toJson(sims: List<SimInfo>): JSONArray {
        val arr = JSONArray()
        sims.forEach { sim ->
            arr.put(
                JSONObject()
                    .put("slot", sim.slot)
                    .put("phoneNumber", sim.phoneNumber ?: JSONObject.NULL)
                    .put("status", sim.status),
            )
        }
        return arr
    }
}
