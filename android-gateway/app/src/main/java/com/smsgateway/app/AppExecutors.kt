package com.smsgateway.app

import java.util.concurrent.Executor
import java.util.concurrent.Executors

object AppExecutors {
    val sms: Executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "sms-send").apply { isDaemon = true }
    }
    val net: Executor = Executors.newCachedThreadPool { r ->
        Thread(r, "sms-net").apply { isDaemon = true }
    }
}
