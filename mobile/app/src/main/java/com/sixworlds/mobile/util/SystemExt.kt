package com.sixworlds.mobile.util

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import android.util.Base64
import android.provider.MediaStore
import android.content.ContentValues

object Notify {
    private const val CHANNEL_ID = "gen_complete"
    private const val REQ_CODE = 1001

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val ch = NotificationChannel(CHANNEL_ID, ctx.getString(ctx.resources.getIdentifier("channel_name", "string", ctx.packageName)), NotificationManager.IMPORTANCE_DEFAULT)
        mgr.createNotificationChannel(ch)
    }

    fun hasPermission(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 33)
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        else true

    fun notifyDone(ctx: Context, title: String, body: String) {
        ensureChannel(ctx)
        val intent = Intent(ctx, com.sixworlds.mobile.MainActivity::class.java)
        val pi = PendingIntent.getActivity(ctx, REQ_CODE, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        NotificationManagerCompat.from(ctx).notify(REQ_CODE, notif)
    }
}

object AlbumSaver {
    fun saveToAlbum(ctx: Context, dataUrl: String, displayName: String): Boolean {
        return runCatching {
            val b64 = dataUrl.substringAfter("base64,", "")
            if (b64.isBlank()) return false
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return false
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "$displayName.png")
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/SixWorlds")
            }
            val uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
            ctx.contentResolver.openOutputStream(uri)?.use { os -> bitmap.compress(Bitmap.CompressFormat.PNG, 95, os) }
            true
        }.getOrDefault(false)
    }
}
