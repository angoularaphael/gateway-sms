package com.smsgateway.app

import android.Manifest
import android.app.role.RoleManager
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.provider.Telephony
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var serverUrl: EditText
    private lateinit var deviceId: EditText
    private lateinit var apiKey: EditText
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            if (!isTyping()) renderStatus()
            handler.postDelayed(this, 2000)
        }
    }

    private val defaultSmsLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            renderStatus()
            if (isDefaultSmsApp()) {
                Toast.makeText(this, "Appli SMS par défaut : OK", Toast.LENGTH_SHORT).show()
            } else {
                showDefaultSmsHelp()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 26) {
            window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)

        serverUrl = findViewById(R.id.serverUrl)
        deviceId = findViewById(R.id.deviceId)
        apiKey = findViewById(R.id.apiKey)
        val connect = findViewById<Button>(R.id.connectButton)
        val defaultSms = findViewById<Button>(R.id.defaultSmsButton)

        serverUrl.setText(prefs.serverUrl)
        deviceId.setText(prefs.deviceId)
        apiKey.setText(prefs.apiKey)

        findViewById<Button>(R.id.pasteUrlButton).setOnClickListener { pasteInto(serverUrl) }
        findViewById<Button>(R.id.pasteDeviceButton).setOnClickListener { pasteInto(deviceId) }
        findViewById<Button>(R.id.pasteKeyButton).setOnClickListener { pasteInto(apiKey) }

        connect.setOnClickListener {
            saveFields()
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
                        if (isFinishing || isDestroyed) return@runOnUiThread
                        Toast.makeText(this, StatusStore.lastError, Toast.LENGTH_LONG).show()
                    }
                    return@thread
                }
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    requestPermissionsThenStart(true)
                    Toast.makeText(this, "Connexion lancée", Toast.LENGTH_SHORT).show()
                }
            }
        }

        defaultSms.setOnClickListener { requestDefaultSmsApp() }
        findViewById<Button>(R.id.restrictedSettingsButton).setOnClickListener { openAppDetails() }
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        saveFields()
        super.onPause()
    }

    private fun isTyping(): Boolean {
        val focus = currentFocus
        return focus is EditText
    }

    private fun saveFields() {
        runCatching {
            prefs.serverUrl = serverUrl.text.toString()
            prefs.deviceId = deviceId.text.toString()
            prefs.apiKey = apiKey.text.toString()
        }
    }

    private fun pasteInto(target: EditText) {
        try {
            val cm = getSystemService(ClipboardManager::class.java)
            val clip = cm?.primaryClip
            if (clip == null || clip.itemCount < 1) {
                Toast.makeText(this, "Presse-papiers vide — copie d’abord depuis le dashboard", Toast.LENGTH_LONG).show()
                return
            }
            val text = clip.getItemAt(0).coerceToText(this).toString().trim()
            if (text.isBlank()) {
                Toast.makeText(this, "Presse-papiers vide", Toast.LENGTH_SHORT).show()
                return
            }
            target.setText(text)
            target.setSelection(target.text.length)
            saveFields()
            Toast.makeText(this, "Collé", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Impossible de coller : ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun isDefaultSmsApp(): Boolean {
        return try {
            if (packageName == Telephony.Sms.getDefaultSmsPackage(this)) return true
            if (Build.VERSION.SDK_INT >= 29) {
                val rm = getSystemService(RoleManager::class.java)
                if (rm != null && rm.isRoleHeld(RoleManager.ROLE_SMS)) return true
            }
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun requestDefaultSmsApp() {
        if (isDefaultSmsApp()) {
            Toast.makeText(this, "Déjà l’appli SMS par défaut", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val rm = getSystemService(RoleManager::class.java)
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_SMS) && !rm.isRoleHeld(RoleManager.ROLE_SMS)) {
                    defaultSmsLauncher.launch(rm.createRequestRoleIntent(RoleManager.ROLE_SMS))
                    return
                }
            }
            if (!openSmsDefaultSettings()) showDefaultSmsHelp()
        } catch (_: Exception) {
            showDefaultSmsHelp()
        }
    }

    private fun openSmsDefaultSettings(): Boolean {
        val intents = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= 33) {
            intents += Intent("android.settings.MANAGE_DEFAULT_APP").putExtra(
                "android.provider.extra.ROLE_NAME",
                RoleManager.ROLE_SMS,
            )
        }
        intents += Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
        intents += Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT).putExtra(
            Telephony.Sms.Intents.EXTRA_PACKAGE_NAME,
            packageName,
        )
        for (intent in intents) {
            try {
                startActivity(intent)
                return true
            } catch (_: Exception) {
            }
        }
        return false
    }

    private fun openAppDetails() {
        try {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", packageName, null),
                ),
            )
        } catch (_: Exception) {
            Toast.makeText(this, "Ouvre Paramètres → Applis → SMS Gateway", Toast.LENGTH_LONG).show()
        }
    }

    private fun showDefaultSmsHelp() {
        AlertDialog.Builder(this)
            .setTitle("Android 15 bloque l’appli SMS par défaut")
            .setMessage(
                """
                L’APK n’est pas installée depuis le Play Store. Android 15 cache alors le rôle SMS.

                1. Appuie sur « Paramètres de l’appli »
                2. Touche les 3 points en haut à droite
                3. Autoriser les réglages restreints (code / empreinte)
                4. Reviens ici et appuie encore sur « Appli SMS par défaut »

                Autre chemin : Paramètres → Applis → Applis par défaut → Appli SMS → SMS Gateway
                """.trimIndent(),
            )
            .setPositiveButton("Paramètres de l’appli") { _, _ -> openAppDetails() }
            .setNeutralButton("Applis par défaut") { _, _ -> openSmsDefaultSettings() }
            .setNegativeButton("OK", null)
            .show()
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
            return
        }
        startGateway(forceRestart)
    }

    private fun startGateway(forceRestart: Boolean) {
        if (prefs.apiKey.isBlank() || prefs.deviceId.isBlank()) return
        if (forceRestart) {
            runCatching { stopService(Intent(this, GatewayService::class.java)) }
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
        if (requestCode != 42) return
        val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (!granted) {
            Toast.makeText(this, "Autorise SMS / téléphone pour envoyer", Toast.LENGTH_LONG).show()
            return
        }
        startGateway(true)
    }

    private fun renderStatus() {
        try {
            val tm = getSystemService(TelephonyManager::class.java)
            val sm = getSystemService(SubscriptionManager::class.java)
            val sims = if (StatusStore.sims.isNotEmpty()) StatusStore.sims else SimReader.read(tm, sm)
            val sim1 = sims.firstOrNull { it.slot == 1 }
            val sim2 = sims.firstOrNull { it.slot == 2 }
            fun dot(sim: SimInfo?) = if (sim?.status == "READY") "Ready" else (sim?.status ?: "ABSENT")
            val errorLine = if (StatusStore.lastError.isBlank()) "" else "\n\nDernière erreur:\n${StatusStore.lastError}"
            val crashLine = if (prefs.lastCrash.isBlank()) "" else "\n\nDernier plantage:\n${prefs.lastCrash}"
            val defaultLine = if (isDefaultSmsApp()) {
                "Appli SMS par défaut : oui"
            } else if (Build.VERSION.SDK_INT >= 35) {
                "Appli SMS par défaut : non — Paramètres de l’appli → ⋮ → Autoriser les réglages restreints"
            } else {
                "Appli SMS par défaut : non — appuie sur le bouton ci-dessus"
            }
            findViewById<TextView>(R.id.statusText).text = """
                Device:
                ${prefs.deviceId.ifBlank { "—" }}

                Connection:
                ${if (StatusStore.connected) "Connected" else "Disconnected"}

                $defaultLine

                SIM 1:
                ${dot(sim1)}

                SIM 2:
                ${dot(sim2)}

                Messages today:
                ${prefs.messagesToday}

                Errors:
                ${prefs.errors}
                $errorLine$crashLine
            """.trimIndent()
        } catch (e: Exception) {
            runCatching {
                findViewById<TextView>(R.id.statusText).text = "Erreur affichage: ${e.message}"
            }
        }
    }
}
