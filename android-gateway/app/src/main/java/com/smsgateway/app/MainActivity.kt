package com.smsgateway.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 2000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)

        val serverUrl = findViewById<EditText>(R.id.serverUrl)
        val deviceId = findViewById<EditText>(R.id.deviceId)
        val apiKey = findViewById<EditText>(R.id.apiKey)
        val connect = findViewById<Button>(R.id.connectButton)

        serverUrl.setText(prefs.serverUrl)
        deviceId.setText(prefs.deviceId)
        apiKey.setText(prefs.apiKey)

        connect.setOnClickListener {
            prefs.serverUrl = serverUrl.text.toString()
            prefs.deviceId = deviceId.text.toString()
            prefs.apiKey = apiKey.text.toString()
            requestPermissionsThenStart()
        }

        requestPermissionsThenStart()
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun requestPermissionsThenStart() {
        val needed = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_PHONE_STATE,
        )
        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 42)
            return
        }
        if (prefs.apiKey.isNotBlank() && prefs.deviceId.isNotBlank()) {
            ContextCompat.startForegroundService(this, Intent(this, GatewayService::class.java))
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            requestPermissionsThenStart()
        }
    }

    private fun renderStatus() {
        val tm = getSystemService(TelephonyManager::class.java)
        val sm = getSystemService(SubscriptionManager::class.java)
        val sims = if (StatusStore.sims.isNotEmpty()) StatusStore.sims else SimReader.read(tm, sm)
        val sim1 = sims.firstOrNull { it.slot == 1 }
        val sim2 = sims.firstOrNull { it.slot == 2 }
        fun dot(sim: SimInfo?) = if (sim?.status == "READY") "🟢 Ready" else "🔴 ${sim?.status ?: "ABSENT"}"
        findViewById<TextView>(R.id.statusText).text = """
            Device:
            ${prefs.deviceId.ifBlank { "—" }}

            Connection:
            ${if (StatusStore.connected) "🟢 Connected" else "🔴 Disconnected"}

            SIM 1:
            ${dot(sim1)}

            SIM 2:
            ${dot(sim2)}

            Messages today:
            ${prefs.messagesToday}

            Errors:
            ${prefs.errors}
        """.trimIndent()
    }
}
