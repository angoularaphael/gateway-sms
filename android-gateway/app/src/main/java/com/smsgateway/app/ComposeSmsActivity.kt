package com.smsgateway.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/** Activité d’écriture SMS exigée par Android pour le rôle SMS par défaut. */
class ComposeSmsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
    }
}
