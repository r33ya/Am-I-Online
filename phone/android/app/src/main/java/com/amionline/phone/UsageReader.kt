package com.amionline.phone

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Process
import android.util.Base64
import java.io.ByteArrayOutputStream

data class ForegroundApp(
    val packageName: String,
    val label: String,
    val icon: String?,
)

/**
 * Reads the current foreground app using the system "Usage access" special permission.
 * This is NOT an accessibility service; the user grants it once in Settings.
 *
 * The app icon is rendered to a small PNG data URI so the web page can show the real icon
 * without any external icon service.
 */
object UsageReader {

    private const val ICON_DP = 48
    private val iconCache = HashMap<String, String?>()

    fun hasPermission(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** The current foreground app, or null if unknown or when it is this app. */
    fun currentForeground(context: Context): ForegroundApp? {
        if (!hasPermission(context)) return null

        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val end = System.currentTimeMillis()
        val events = usm.queryEvents(end - 60_000, end)
        val event = UsageEvents.Event()

        val resumed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            UsageEvents.Event.ACTIVITY_RESUMED
        } else {
            @Suppress("DEPRECATION")
            UsageEvents.Event.MOVE_TO_FOREGROUND
        }

        var pkg: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == resumed) pkg = event.packageName
        }

        val name = pkg ?: return null
        if (name == context.packageName) return null

        val label = try {
            val pm = context.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(name, 0)).toString()
        } catch (_: Exception) {
            name
        }
        return ForegroundApp(name, label, iconDataUri(context, name))
    }

    private fun iconDataUri(context: Context, pkg: String): String? {
        synchronized(iconCache) {
            if (iconCache.containsKey(pkg)) return iconCache[pkg]
        }

        val result = try {
            val drawable = context.packageManager.getApplicationIcon(pkg)
            val size = (ICON_DP * context.resources.displayMetrics.density).toInt().coerceAtLeast(48)
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(Canvas(bitmap))
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            null
        }

        synchronized(iconCache) { iconCache[pkg] = result }
        return result
    }
}
