package com.amionline.phone

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Persistent WebSocket connection with automatic reconnect and exponential backoff.
 * Reports screen state and the current foreground app to the Am-I-Online server.
 */
class WsClient(
    private val serverUrl: String,
    private val token: String,
    private val deviceId: String,
    private val deviceName: String,
    private val onLog: (String) -> Unit,
    private val onReady: () -> Unit = {},
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    @Volatile private var ws: WebSocket? = null
    @Volatile private var running = false
    private var backoffMs = 1000L

    /** Package whose icon was last sent, so heartbeats stay small. */
    @Volatile private var lastIconPackage: String? = null

    fun start() {
        running = true
        connect()
    }

    fun stop() {
        running = false
        try {
            ws?.close(1000, null)
        } catch (_: Exception) {
        }
        ws = null
    }

    fun sendState(screen: String, app: ForegroundApp?) {
        val socket = ws ?: return
        val state = JSONObject().put("screen", screen)
        if (app != null) {
            val activity = JSONObject()
                .put("package", app.packageName)
                .put("label", app.label)
            // Send the icon once per app switch, not on every heartbeat.
            if (app.packageName != lastIconPackage) {
                lastIconPackage = app.packageName
                if (app.icon != null) activity.put("icon", app.icon)
            }
            state.put("activity", activity)
        }
        val message = JSONObject().put("type", "state").put("state", state)
        try {
            socket.send(message.toString())
        } catch (_: Exception) {
        }
    }

    private fun connect() {
        if (!running) return
        val url = buildUrl()
        if (url.isEmpty()) {
            onLog("server url not set")
            return
        }
        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                backoffMs = 1000L
                // A fresh connection means the server may have no icon yet.
                lastIconPackage = null
                onLog("connected")
                onReady()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // Server "hello" and pongs are ignored.
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                scheduleReconnect("closed")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scheduleReconnect(t.message ?: "failure")
            }
        })
    }

    private fun scheduleReconnect(reason: String) {
        if (!running) return
        val delay = backoffMs
        backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
        onLog("reconnect in ${delay}ms ($reason)")
        Thread {
            try {
                Thread.sleep(delay)
            } catch (_: InterruptedException) {
            }
            connect()
        }.start()
    }

    private fun buildUrl(): String {
        if (serverUrl.isBlank()) return ""
        val sep = if (serverUrl.contains('?')) '&' else '?'
        return serverUrl + sep +
            "deviceId=" + URLEncoder.encode(deviceId, "UTF-8") +
            "&kind=phone" +
            "&name=" + URLEncoder.encode(deviceName, "UTF-8") +
            "&token=" + URLEncoder.encode(token, "UTF-8")
    }
}
