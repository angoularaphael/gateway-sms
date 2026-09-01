package com.smsgateway.app

import android.Manifest
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 1500)
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
        val defaultSms = findViewById<Button>(R.id.defaultSmsButton)

        serverUrl.setText(prefs.serverUrl)
        deviceId.setText(prefs.deviceId)
        apiKey.setText(prefs.apiKey)

        connect.setOnClickListener {
            prefs.serverUrl = serverUrl.text.toString()
            prefs.deviceId = deviceId.text.toString()
            prefs.apiKey = apiKey.text.toString()
            serverUrl.setText(prefs.serverUrl)
            if (prefs.deviceId.isBlank() || prefs.apiKey.isBlank()) {
                Toast.makeText(this, "Device ID et clé API requis", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            StatusStore.lastError = "Test du serveur…"
            renderStatus()
            thread {
                try {
                    GatewayClient(prefs).health()
                    StatusStore.lastError = "Serveur OK, connexion appareil…"
                } catch (e: Exception) {
                    StatusStore.connected = false
                    StatusStore.lastError = e.message ?: "Échec connexion serveur"
                    runOnUiThread {
                        Toast.makeText(this, StatusStore.lastError, Toast.LENGTH_LONG).show()
                    }
                    return@thread
                }
                runOnUiThread {
                    requestPermissionsThenStart(true)
                    Toast.makeText(this, "Connexion lancée", Toast.LENGTH_SHORT).show()
                }
            }
        }

        defaultSms.setOnClickListener { requestDefaultSmsApp() }
        requestPermissionsThenStart(false)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun isDefaultSmsApp(): Boolean {
        return packageName == Telephony.Sms.getDefaultSmsPackage(this)
    }

    private fun requestDefaultSmsApp() {
        if (isDefaultSmsApp()) {
            Toast.makeText(this, "Déjà l’appli SMS par défaut", Toast.LENGTH_SHORT).show()
            return
        }
        if (Build.VERSION.SDK_INT >= 29) {
            val rm = getSystemService(RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_SMS) && !rm.isRoleHeld(RoleManager.ROLE_SMS)) {
                startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_SMS), 99)
                return
            }
        }
        val intent = Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT)
        intent.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, packageName)
        startActivity(intent)
    }

    private fun requestPermissionsThenStart(forceRestart: Boolean) {
        val needed = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_SMS,
        )
        if (Build.VERSION.SDK_INT >= 33) needed.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = needed.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 42)
        }
        if (prefs.apiKey.isBlank() || prefs.deviceId.isBlank()) return
        if (forceRestart) {
            stopService(Intent(this, GatewayService::class.java))
        }
        try {
            ContextCompat.startForegroundService(this, Intent(this, GatewayService::class.java))
        } catch (e: Exception) {
            StatusStore.lastError = e.message ?: "Impossible de démarrer le service"
            Toast.makeText(this, StatusStore.lastError, Toast.LENGTH_LONG).show()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        requestPermissionsThenStart(true)
    }

    private fun renderStatus() {
        val tm = getSystemService(TelephonyManager::class.java)
        val sm = getSystemService(SubscriptionManager::class.java)
        val sims = if (StatusStore.sims.isNotEmpty()) StatusStore.sims else SimReader.read(tm, sm)
        val sim1 = sims.firstOrNull { it.slot == 1 }
        val sim2 = sims.firstOrNull { it.slot == 2 }
        fun dot(sim: SimInfo?) = if (sim?.status == "READY") "🟢 Ready" else "🔴 ${sim?.status ?: "ABSENT"}"
        val errorLine = if (StatusStore.lastError.isBlank()) "" else "\n\nDernière erreur:\n${StatusStore.lastError}"
        val defaultLine = if (isDefaultSmsApp()) "Applis SMS par défaut : oui (pas de popup quota)" else "Applis SMS par défaut : non — appuie sur le bouton ci-dessus"
        findViewById<TextView>(R.id.statusText).text = """
            Device:
            ${prefs.deviceId.ifBlank { "—" }}

            Connection:
            ${if (StatusStore.connected) "🟢 Connected" else "🔴 Disconnected"}

            $defaultLine

            SIM 1:
            ${dot(sim1)}

            SIM 2:
            ${dot(sim2)}

            Messages today:
            ${prefs.messagesToday}

            Errors:
            ${prefs.errors}
            $errorLine
        """.trimIndent()
    }
}
