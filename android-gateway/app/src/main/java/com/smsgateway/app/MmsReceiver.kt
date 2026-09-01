package com.smsgateway.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Stub MMS obligatoire pour le rôle SMS par défaut. */
class MmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = Unit
}
