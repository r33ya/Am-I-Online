package com.amionline.phone

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat

class MainActivity : AppCompatActivity() {

    private lateinit var serverInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var nameInput: EditText
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverInput = findViewById(R.id.serverInput)
        tokenInput = findViewById(R.id.tokenInput)
        nameInput = findViewById(R.id.nameInput)
        statusText = findViewById(R.id.statusText)

        val prefs = Prefs.get(this)
        serverInput.setText(prefs.getString(Prefs.KEY_SERVER, "ws://192.168.1.10:8787/ws"))
        tokenInput.setText(prefs.getString(Prefs.KEY_TOKEN, ""))
        nameInput.setText(prefs.getString(Prefs.KEY_NAME, Build.MODEL))

        findViewById<Button>(R.id.saveButton).setOnClickListener {
            save()
            toast("Saved")
            refreshStatus()
        }

        findViewById<Button>(R.id.startButton).setOnClickListener {
            save()
            if (!UsageReader.hasPermission(this)) toast("Grant 'Usage access' for current app")
            requestNotificationPermission()
            startForegroundServiceCompat()
            toast("Sharing started")
            refreshStatus()
        }

        findViewById<Button>(R.id.stopButton).setOnClickListener {
            stopForegroundService()
            toast("Stopped")
            refreshStatus()
        }

        findViewById<Button>(R.id.usageButton).setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            } catch (_: Exception) {
                toast("Open Settings > Apps > Special access > Usage access")
            }
        }

        findViewById<Button>(R.id.batteryButton).setOnClickListener {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                intent.data = Uri.parse("package:$packageName")
                startActivity(intent)
            } catch (_: Exception) {
                toast("Open Settings > Battery > unrestricted")
            }
        }

        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun save() {
        Prefs.get(this).edit()
            .putString(Prefs.KEY_SERVER, serverInput.text.toString().trim())
            .putString(Prefs.KEY_TOKEN, tokenInput.text.toString().trim())
            .putString(Prefs.KEY_NAME, nameInput.text.toString().trim())
            .apply()
    }

    private fun startForegroundServiceCompat() {
        Prefs.get(this).edit().putBoolean(Prefs.KEY_ENABLED, true).apply()
        val intent = Intent(this, StatusService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun stopForegroundService() {
        Prefs.get(this).edit().putBoolean(Prefs.KEY_ENABLED, false).apply()
        stopService(Intent(this, StatusService::class.java))
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                1,
            )
        }
    }

    private fun refreshStatus() {
        val enabled = Prefs.get(this).getBoolean(Prefs.KEY_ENABLED, false)
        val usage = if (UsageReader.hasPermission(this)) "granted" else "NOT granted"
        statusText.text = buildString {
            append("Service: ")
            append(if (enabled) "enabled" else "disabled")
            append("\nUsage access: ")
            append(usage)
        }
    }

    private fun toast(message: String) =
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
}
