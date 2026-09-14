package com.smsgateway.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/** Activité exigée par Android pour le rôle SMS. Ne pas relancer MainActivity (ça reset la saisie). */
class ComposeSmsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
    }
}
