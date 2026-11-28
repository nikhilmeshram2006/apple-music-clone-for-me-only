package app.antideploy.aurel

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.view.Gravity
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity(), AurelPlaybackService.Listener {

    private lateinit var webView: WebView
    private lateinit var offlineOverlay: LinearLayout
    private var playbackService: AurelPlaybackService? = null
    private var serviceBound = false
    @Volatile
    private var currentHost: String = PRIMARY_HOST

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? AurelPlaybackService.LocalBinder ?: return
            playbackService = binder.getService().also { it.setListener(this@MainActivity) }
            serviceBound = true
            onDevicesChanged()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            playbackService?.setListener(null)
            playbackService = null
            serviceBound = false
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, true)
        window.statusBarColor = Color.parseColor("#070709")
        window.navigationBarColor = Color.parseColor("#070709")
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#070709"))
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#070709"))
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportMultipleWindows(false)
            }
            addJavascriptInterface(AurelJsBridge(), "AurelNative")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    url?.let { currentHost = Uri.parse(it).host.orEmpty() }
                }

                override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    url?.let { currentHost = Uri.parse(it).host.orEmpty() }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    offlineOverlay.visibility = View.GONE
                    onDevicesChanged()
                }

                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.scheme == "https" && ALLOWED_HOSTS.contains(uri.host)) {
                        return false
                    }
                    if (uri.scheme == "https" || uri.scheme == "http") {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                        } catch (_: Exception) {
                        }
                        return true
                    }
                    return true
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    super.onReceivedError(view, request, error)
                    if (request?.isForMainFrame == true) {
                        offlineOverlay.visibility = View.VISIBLE
                    }
                }
            }
        }

        offlineOverlay = buildOfflineView()
        root.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))
        root.addView(offlineOverlay, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, windowInsets ->
            val insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            v.setPadding(insets.left, insets.top, insets.right, insets.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        ViewCompat.requestApplyInsets(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        requestRuntimePermissions()

        val svcIntent = Intent(this, AurelPlaybackService::class.java)
        startService(svcIntent)
        bindService(svcIntent, connection, Context.BIND_AUTO_CREATE)

        webView.loadUrl(APP_URL)
    }

    override fun onDestroy() {
        if (serviceBound) {
            playbackService?.setListener(null)
            unbindService(connection)
            serviceBound = false
        }
        webView.destroy()
        super.onDestroy()
    }

    override fun onAudioEvent(type: String, currentTimeSec: Double, durationSec: Double) {
        val payload = JSONObject().apply {
            put("currentTime", currentTimeSec)
            put("duration", durationSec)
        }.toString()
        val js = "window.__aurelNativeEvent && window.__aurelNativeEvent(${JSONObject.quote(type)}, $payload);"
        runJs(js)
    }

    override fun onRemoteAction(action: String) {
        val js = "window.__aurelNativeAction && window.__aurelNativeAction(${JSONObject.quote(action)});"
        runJs(js)
    }

    override fun onDevicesChanged() {
        runJs("window.dispatchEvent(new CustomEvent('aurel-native-devices'));")
    }

    private fun runJs(script: String) {
        if (!::webView.isInitialized) return
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun requestRuntimePermissions() {
        val needed = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 401)
        }
    }

    private fun buildOfflineView(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#070709"))
            setPadding(64, 64, 64, 64)
            visibility = View.GONE

            addView(TextView(context).apply {
                text = "AUREL"
                textSize = 26f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                text = "Could not reach aurel.antideploy.app. Check your internet connection and try again."
                textSize = 14f
                setTextColor(Color.parseColor("#B4B4BE"))
                gravity = Gravity.CENTER
                setPadding(0, 24, 0, 40)
            })
            addView(Button(context).apply {
                text = "Retry"
                setBackgroundColor(Color.parseColor("#9333EA"))
                setTextColor(Color.WHITE)
                setOnClickListener {
                    visibility = View.GONE
                    webView.loadUrl(APP_URL)
                }
            })
        }
    }

    private fun isTrustedOrigin(): Boolean = ALLOWED_HOSTS.contains(currentHost)

    inner class AurelJsBridge {
        @JavascriptInterface
        fun load(url: String) {
            if (!isTrustedOrigin()) return
            playbackService?.loadTrack(url)
        }

        @JavascriptInterface
        fun play() {
            if (!isTrustedOrigin()) return
            playbackService?.startPlayback()
        }

        @JavascriptInterface
        fun pause() {
            if (!isTrustedOrigin()) return
            playbackService?.pausePlayback()
        }

        @JavascriptInterface
        fun seekTo(ms: Int) {
            if (!isTrustedOrigin()) return
            playbackService?.seekToMs(ms)
        }

        @JavascriptInterface
        fun setVolume(vol: Float) {
            if (!isTrustedOrigin()) return
            playbackService?.setVolumeLevel(vol)
        }

        @JavascriptInterface
        fun setMetadata(title: String, artist: String, album: String, artUrl: String) {
            if (!isTrustedOrigin()) return
            playbackService?.setTrackMetadata(title, artist, album, artUrl)
        }

        @JavascriptInterface
        fun getOutputDevices(): String {
            if (!isTrustedOrigin()) return "{\"devices\":[]}"
            return playbackService?.getOutputDevicesJson() ?: "{\"devices\":[]}"
        }

        @JavascriptInterface
        fun setOutputDevice(id: String): Boolean {
            if (!isTrustedOrigin()) return false
            return playbackService?.setPreferredOutput(id) ?: false
        }

        @JavascriptInterface
        fun openSystemOutputPicker() {
            if (!isTrustedOrigin()) return
            runOnUiThread {
                val actions = listOf(
                    "com.android.systemui.action.LAUNCH_MEDIA_OUTPUT_DIALOG",
                    "com.android.settings.panel.action.MEDIA_OUTPUT"
                )
                for (act in actions) {
                    try {
                        val intent = Intent(act).apply {
                            putExtra("package_name", packageName)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(intent)
                        return@runOnUiThread
                    } catch (_: Exception) {
                    }
                }
            }
        }
    }

    companion object {
        private const val PRIMARY_HOST = "aurel.antideploy.app"
        private val ALLOWED_HOSTS = setOf(PRIMARY_HOST, "nikhilmeshram2006.github.io")
        private const val APP_URL = "https://$PRIMARY_HOST/"
    }
}
