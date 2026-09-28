package com.amionline.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the WebSocket alive and reports:
 *  - screen on/off  -> online/offline
 *  - current foreground app (needs Usage access)
 */
class StatusService : Service() {

    private var ws: WsClient? = null
    private val handler = Handler(Looper.getMainLooper())
    private var screenOn = true

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            screenOn = intent?.action == Intent.ACTION_SCREEN_ON
            push()
        }
    }

    private val loop = object : Runnable {
        override fun run() {
            push()
            handler.postDelayed(this, 4000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()

        val prefs = Prefs.get(this)
        val server = prefs.getString(Prefs.KEY_SERVER, "") ?: ""
        val token = prefs.getString(Prefs.KEY_TOKEN, "") ?: ""
        val name = prefs.getString(Prefs.KEY_NAME, Build.MODEL) ?: Build.MODEL
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "device"

        ws = WsClient(
            server,
            token,
            "phone-" + androidId.take(8),
            name,
            { msg -> Log.d(TAG, msg) },
            { handler.post { push() } },
        ).also { it.start() }

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        registerReceiver(screenReceiver, filter)
        handler.post(loop)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        return START_STICKY
    }

    private fun push() {
        val pm = getSystemService(PowerManager::class.java)
        val on = pm?.isInteractive ?: screenOn
        val activity = UsageReader.currentForeground(this)
        ws?.sendState(if (on) "on" else "off", activity)
    }

    private fun startForegroundCompat() {
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Am-I-Online")
            .setContentText("Sharing screen state and current app")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Status", NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(loop)
        try {
            unregisterReceiver(screenReceiver)
        } catch (_: Exception) {
        }
        ws?.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "AmIOnline"
        private const val CHANNEL = "amionline"
        private const val NOTIF_ID = 1
    }
}
