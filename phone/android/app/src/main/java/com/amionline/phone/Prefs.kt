package com.amionline.phone

import android.content.Context
import android.content.SharedPreferences

object Prefs {
    private const val FILE = "amionline"

    const val KEY_SERVER = "server"
    const val KEY_TOKEN = "token"
    const val KEY_NAME = "name"
    const val KEY_ENABLED = "enabled"

    fun get(context: Context): SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
