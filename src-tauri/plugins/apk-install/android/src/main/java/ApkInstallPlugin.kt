package com.noodle.apkinstall

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

/** Its own class, so it never clashes with another FileProvider in the app. */
class ApkFileProvider : FileProvider()

@InvokeArg
class InstallArgs {
    lateinit var path: String
}

@TauriPlugin
class ApkInstallPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun install(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallArgs::class.java)
            // Only files in cache/updates can be shared with the installer.
            val updates = File(activity.cacheDir, "updates").apply { mkdirs() }
            var apk = File(args.path)
            if (apk.canonicalFile.parentFile != updates.canonicalFile) {
                apk = apk.copyTo(File(updates, "noodle-update.apk"), overwrite = true)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
                val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
                activity.startActivity(settings)
                invoke.reject("Turn on \"Allow from this source\" for Noodle, then come back and tap Update again.")
                return
            }

            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".apkinstall", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Couldn't open the installer")
        }
    }
}
