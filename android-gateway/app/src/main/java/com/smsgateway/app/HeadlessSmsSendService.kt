package com.smsgateway.app

import android.app.Service
import android.content.Intent
import android.os.IBinder

/** Stub « répondre par SMS » obligatoire pour le rôle SMS par défaut. */
class HeadlessSmsSendService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
}
