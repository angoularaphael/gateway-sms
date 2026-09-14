package com.smsgateway.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.time.LocalDate
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object JobGuard {
    private val inFlight = Collections.synchronizedSet(mutableSetOf<String>())

    fun begin(id: String): Boolean = inFlight.add(id)

    fun complete(id: String) {
        inFlight.remove(id)
    }
}

class GatewayService : Service() {
    private var scheduler: ScheduledExecutorService? = null
    private lateinit var prefs: Prefs
    private lateinit var client: GatewayClient
    private val tickRunning = AtomicBoolean(false)

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        client = GatewayClient(prefs)
        createChannel()
        startFg("Connexion…")
        val exec = Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "gateway-tick").apply { isDaemon = true }
        }
        scheduler = exec
        exec.scheduleWithFixedDelay({ tick() }, 0, 8, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startFg(if (StatusStore.connected) "Connecté" else "Connexion…")
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        runCatching {
            ContextCompat.startForegroundService(applicationContext, Intent(this, GatewayService::class.java))
        }
    }

    private fun fgsType(): Int {
        if (Build.VERSION.SDK_INT < 29) return 0
        return ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
    }

    private fun startFg(text: String) {
        val notification = notification(text)
        try {
            ServiceCompat.startForeground(this, 1, notification, fgsType())
            return
        } catch (_: Throwable) {
        }
        if (Build.VERSION.SDK_INT >= 29) {
            runCatching {
                ServiceCompat.startForeground(
                    this,
                    1,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                )
            }
        }
    }

    private fun tick() {
        if (!tickRunning.compareAndSet(false, true)) return
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
            }.getOrNull() ?: "1.0.10"

            client.heartbeat(version ?: "1.0.10", SimReader.toJson(sims))
            StatusStore.connected = true
            if (StatusStore.lastError.startsWith("HTTP") || StatusStore.lastError.contains("Connexion")) {
                StatusStore.lastError = ""
            }
            if (System.currentTimeMillis() < StatusStore.pauseSendsUntil) {
                return
            }
            val jobs = client.pendingJobs()
            if (jobs.length() > 0) {
                handleJob(jobs.getJSONObject(0))
            }
        } catch (err: Throwable) {
            StatusStore.connected = false
            StatusStore.lastError = err.message ?: err.javaClass.simpleName
        } finally {
            tickRunning.set(false)
            startFg(if (StatusStore.connected) "Connecté" else "Hors ligne")
        }
    }

    private fun handleJob(job: JSONObject) {
        val nested = job.optJSONObject("job") ?: job
        val recipientId = nested.optString("recipientId")
        val phone = nested.optString("phoneNumber")
        val message = nested.optString("message")
        val simSlot = nested.optInt("simSlot", 1)
        if (recipientId.isBlank() || phone.isBlank()) return
        if (prefs.wasSent(recipientId)) {
            AppExecutors.net.execute {
                runCatching { client.smsResult(recipientId, true, stage = "sent") }
            }
            return
        }
        if (!JobGuard.begin(recipientId)) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            JobGuard.complete(recipientId)
            StatusStore.lastError = "Permission SMS refusée"
            AppExecutors.net.execute {
                runCatching { client.smsResult(recipientId, false, "SMS_FAILED", "SEND_SMS permission denied", "sent") }
            }
            return
        }
        val appContext = applicationContext
        AppExecutors.sms.execute {
            try {
                SmsSender.send(appContext, phone, message, recipientId, simSlot)
            } catch (e: Throwable) {
                JobGuard.complete(recipientId)
                prefs.errors = prefs.errors + 1
                StatusStore.lastError = e.message ?: e.javaClass.simpleName
                AppExecutors.net.execute {
                    runCatching { client.smsResult(recipientId, false, "SMS_FAILED", e.message, "sent") }
                }
            }
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
        val nm = getSystemService(NotificationManager::class.java) ?: return
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
        scheduler?.shutdownNow()
        scheduler = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

object StatusStore {
    @Volatile var connected: Boolean = false
    @Volatile var lastError: String = ""
    @Volatile var sims: List<SimInfo> = emptyList()
    @Volatile var pauseSendsUntil: Long = 0
}
