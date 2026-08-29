package com.smsgateway.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.time.LocalDate
import java.util.Timer
import java.util.TimerTask

class GatewayService : Service() {
    private var timer: Timer? = null
    private lateinit var prefs: Prefs
    private lateinit var client: GatewayClient

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        client = GatewayClient(prefs)
        createChannel()
        startForeground(1, notification("Connexion…"))
        timer = Timer()
        timer?.scheduleAtFixedRate(object : TimerTask() {
            override fun run() = tick()
        }, 0, 15_000)
    }

    private fun tick() {
        try {
            resetDailyIfNeeded()
            val tm = getSystemService(TelephonyManager::class.java)
            val sm = getSystemService(SubscriptionManager::class.java)
            val sims = SimReader.read(tm, sm)
            StatusStore.sims = sims
            val version = runCatching {
                if (Build.VERSION.SDK_INT >= 33) {
                    packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0)).versionName
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(packageName, 0).versionName
                }
            }.getOrNull() ?: "1.0.0"

            client.heartbeat(version ?: "1.0.0", SimReader.toJson(sims))
            StatusStore.connected = true
            val jobs = client.pendingJobs()
            for (i in 0 until jobs.length()) {
                handleJob(jobs.getJSONObject(i))
            }
        } catch (_: Exception) {
            StatusStore.connected = false
        }
        startForeground(1, notification(if (StatusStore.connected) "Connecté" else "Hors ligne"))
    }

    private fun handleJob(job: JSONObject) {
        val nested = job.optJSONObject("job") ?: job
        val recipientId = nested.optString("recipientId")
        val phone = nested.optString("phoneNumber")
        val message = nested.optString("message")
        val simSlot = nested.optInt("simSlot", 1)
        if (recipientId.isBlank() || phone.isBlank()) return
        try {
            SmsSender.send(this, phone, message, recipientId, simSlot)
        } catch (e: Exception) {
            prefs.errors = prefs.errors + 1
            client.smsResult(recipientId, false, "SMS_FAILED", e.message)
        }
    }

    private fun resetDailyIfNeeded() {
        val today = LocalDate.now().toString()
        if (prefs.lastDay != today) {
            prefs.lastDay = today
            prefs.messagesToday = 0
        }
    }

    private fun createChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel("gateway", "SMS Gateway", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun notification(text: String): Notification {
        return NotificationCompat.Builder(this, "gateway")
            .setContentTitle("SMS Gateway")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        timer?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

object StatusStore {
    @Volatile var connected: Boolean = false
    @Volatile var sims: List<SimInfo> = emptyList()
}
