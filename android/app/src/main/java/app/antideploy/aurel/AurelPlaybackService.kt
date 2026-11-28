package app.antideploy.aurel

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.AudioRouting
import android.media.MediaPlayer
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class AurelPlaybackService : Service() {

    interface Listener {
        fun onAudioEvent(type: String, currentTimeSec: Double, durationSec: Double)
        fun onRemoteAction(action: String)
        fun onDevicesChanged()
    }

    inner class LocalBinder : Binder() {
        fun getService(): AurelPlaybackService = this@AurelPlaybackService
    }

    private val binder = LocalBinder()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val imgExecutor = Executors.newSingleThreadExecutor()

    private lateinit var audioManager: AudioManager
    private lateinit var notificationManager: NotificationManager
    private lateinit var mediaSession: MediaSessionCompat

    private var mediaPlayer: MediaPlayer? = null
    private var focusRequest: AudioFocusRequest? = null
    private var noisyRegistered = false

    private var listener: Listener? = null
    private var isPrepared = false
    private var autoPlayPending = false
    private var volumeLevel = 0.9f
    private var preferredDeviceId: Int? = null
    private var durationMs = 180_000L

    private var curTitle = "AUREL"
    private var curArtist = "Lossless Audio"
    private var curAlbum = ""
    private var curArtUrl = ""
    private var curArtBitmap: Bitmap? = null
    private var isForegroundStarted = false

    private val routingListener = AudioRouting.OnRoutingChangedListener {
        mainHandler.post { listener?.onDevicesChanged() }
    }

    private val audioDeviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
            mainHandler.post { listener?.onDevicesChanged() }
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
            mainHandler.post {
                val prefId = preferredDeviceId
                if (prefId != null && removedDevices?.any { it.id == prefId } == true) {
                    preferredDeviceId = null
                    try {
                        mediaPlayer?.preferredDevice = null
                    } catch (_: Exception) {
                    }
                }
                listener?.onDevicesChanged()
            }
        }
    }

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY == intent?.action) {
                mainHandler.post { pausePlayback() }
            }
        }
    }

    private val tickRunnable = object : Runnable {
        override fun run() {
            val mp = mediaPlayer
            if (mp != null && isPrepared) {
                try {
                    if (mp.isPlaying) {
                        val pos = mp.currentPosition / 1000.0
                        val dur = (if (mp.duration > 0) mp.duration.toDouble() else durationMs.toDouble()) / 1000.0
                        listener?.onAudioEvent("timeupdate", pos, dur)
                        mainHandler.postDelayed(this, 200L)
                    }
                } catch (_: Exception) {
                }
            }
        }
    }

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> pausePlayback()
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                try {
                    mediaPlayer?.setVolume(volumeLevel * 0.25f, volumeLevel * 0.25f)
                } catch (_: Exception) {
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                try {
                    mediaPlayer?.setVolume(volumeLevel, volumeLevel)
                } catch (_: Exception) {
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureNotificationChannel()

        mediaSession = MediaSessionCompat(this, "AurelMediaSession").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    listener?.onRemoteAction("play")
                }

                override fun onPause() {
                    listener?.onRemoteAction("pause")
                }

                override fun onSkipToNext() {
                    listener?.onRemoteAction("next")
                }

                override fun onSkipToPrevious() {
                    listener?.onRemoteAction("prev")
                }

                override fun onSeekTo(pos: Long) {
                    seekToMs(pos.toInt())
                }
            })
            isActive = true
        }

        audioManager.registerAudioDeviceCallback(audioDeviceCallback, mainHandler)
        try {
            ContextCompat.registerReceiver(
                this,
                noisyReceiver,
                IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_EXPORTED
            )
            noisyRegistered = true
        } catch (_: Exception) {
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> listener?.onRemoteAction("play")
            ACTION_PAUSE -> listener?.onRemoteAction("pause")
            ACTION_NEXT -> listener?.onRemoteAction("next")
            ACTION_PREV -> listener?.onRemoteAction("prev")
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(tickRunnable)
        audioManager.unregisterAudioDeviceCallback(audioDeviceCallback)
        if (noisyRegistered) {
            try {
                unregisterReceiver(noisyReceiver)
            } catch (_: Exception) {
            }
            noisyRegistered = false
        }
        abandonAudioFocus()
        releasePlayer()
        mediaSession.release()
        imgExecutor.shutdownNow()
        super.onDestroy()
    }

    fun setListener(l: Listener?) {
        listener = l
    }

    fun loadTrack(url: String) {
        mainHandler.post {
            if (!url.startsWith("https://")) return@post
            autoPlayPending = false
            isPrepared = false
            mainHandler.removeCallbacks(tickRunnable)
            listener?.onAudioEvent("waiting", 0.0, durationMs / 1000.0)

            val mp = ensurePlayer()
            try {
                mp.reset()
                configurePlayer(mp)
                mp.setDataSource(url)
                mp.prepareAsync()
            } catch (_: Exception) {
                listener?.onAudioEvent("error", 0.0, 0.0)
            }
        }
    }

    fun startPlayback() {
        mainHandler.post {
            val mp = mediaPlayer ?: return@post
            if (!isPrepared) {
                autoPlayPending = true
                return@post
            }
            if (!mp.isPlaying) {
                requestAudioFocus()
                applyPreferredDevice(mp)
                mp.start()
                emitPlayState(isPlaying = true)
            }
        }
    }

    fun pausePlayback() {
        mainHandler.post {
            autoPlayPending = false
            val mp = mediaPlayer ?: return@post
            try {
                if (isPrepared && mp.isPlaying) {
                    mp.pause()
                    emitPlayState(isPlaying = false)
                }
            } catch (_: Exception) {
            }
        }
    }

    fun seekToMs(ms: Int) {
        mainHandler.post {
            val mp = mediaPlayer ?: return@post
            if (!isPrepared) return@post
            try {
                val safe = ms.coerceIn(0, (mp.duration - 50).coerceAtLeast(0))
                mp.seekTo(safe)
                val pos = mp.currentPosition / 1000.0
                val dur = (if (mp.duration > 0) mp.duration.toDouble() else durationMs.toDouble()) / 1000.0
                listener?.onAudioEvent("timeupdate", pos, dur)
                updateSessionAndNotification(mp.isPlaying)
            } catch (_: Exception) {
            }
        }
    }

    fun setVolumeLevel(vol: Float) {
        mainHandler.post {
            volumeLevel = vol.coerceIn(0f, 1f)
            try {
                mediaPlayer?.setVolume(volumeLevel, volumeLevel)
            } catch (_: Exception) {
            }
        }
    }

    fun setTrackMetadata(title: String, artist: String, album: String, artUrl: String) {
        mainHandler.post {
            curTitle = title.ifBlank { "AUREL" }
            curArtist = artist.ifBlank { "Unknown Artist" }
            curAlbum = album
            val artChanged = artUrl != curArtUrl
            curArtUrl = artUrl
            if (artChanged) {
                curArtBitmap = null
                if (artUrl.startsWith("https://")) {
                    imgExecutor.execute {
                        val bmp = fetchBitmap(artUrl)
                        mainHandler.post {
                            if (curArtUrl == artUrl) {
                                curArtBitmap = bmp
                                val playing = try {
                                    isPrepared && (mediaPlayer?.isPlaying == true)
                                } catch (_: Exception) {
                                    false
                                }
                                updateSessionAndNotification(playing)
                            }
                        }
                    }
                }
            }
            val playing = try {
                isPrepared && (mediaPlayer?.isPlaying == true)
            } catch (_: Exception) {
                false
            }
            updateSessionAndNotification(playing)
        }
    }

    fun getOutputDevicesJson(): String {
        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        val result = JSONArray()
        val seenIds = HashSet<Int>()
        var hasSpeaker = false

        for (d in devices) {
            val kind: String
            val subtitle: String
            val rawName: String

            if (isBluetoothOutput(d)) {
                kind = "bluetooth"
                subtitle = "Bluetooth Audio"
                rawName = d.productName?.toString()?.trim().orEmpty().ifBlank { "Bluetooth Audio" }
            } else if (isWiredHeadphoneOutput(d)) {
                kind = "headphones"
                subtitle = "Wired / USB Audio"
                rawName = d.productName?.toString()?.trim().orEmpty().ifBlank { "Headphones" }
            } else if (d.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                kind = "speaker"
                subtitle = "Device Speaker"
                rawName = "Phone Speaker"
                hasSpeaker = true
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                d.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE && !hasSpeaker
            ) {
                kind = "speaker"
                subtitle = "Device Speaker"
                rawName = "Phone Speaker"
                hasSpeaker = true
            } else {
                continue
            }

            if (!seenIds.add(d.id)) continue
            result.put(JSONObject().apply {
                put("id", d.id.toString())
                put("name", rawName)
                put("kind", kind)
                put("subtitle", subtitle)
            })
        }

        val routedId = try {
            mediaPlayer?.routedDevice?.id?.toString() ?: ""
        } catch (_: Exception) {
            ""
        }

        return JSONObject().apply {
            put("devices", result)
            put("routedId", routedId)
            put("preferredId", preferredDeviceId?.toString() ?: "auto")
        }.toString()
    }

    fun setPreferredOutput(deviceIdStr: String): Boolean {
        return try {
            if (deviceIdStr == "auto" || deviceIdStr.isBlank()) {
                preferredDeviceId = null
                mediaPlayer?.preferredDevice = null
            } else {
                val targetId = deviceIdStr.toIntOrNull() ?: return false
                val target = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                    .firstOrNull { it.id == targetId } ?: return false
                preferredDeviceId = target.id
                mediaPlayer?.preferredDevice = target
            }
            mainHandler.postDelayed({ listener?.onDevicesChanged() }, 120L)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun isBluetoothOutput(d: AudioDeviceInfo): Boolean {
        if (d.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || d.type == AudioDeviceInfo.TYPE_HEARING_AID) {
            return true
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            (d.type == AudioDeviceInfo.TYPE_BLE_HEADSET || d.type == AudioDeviceInfo.TYPE_BLE_SPEAKER)
        ) {
            return true
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            d.type == AudioDeviceInfo.TYPE_BLE_BROADCAST
        ) {
            return true
        }
        return false
    }

    private fun isWiredHeadphoneOutput(d: AudioDeviceInfo): Boolean {
        return d.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            d.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            d.type == AudioDeviceInfo.TYPE_USB_HEADSET
    }

    private fun ensurePlayer(): MediaPlayer {
        val existing = mediaPlayer
        if (existing != null) return existing
        return MediaPlayer().also { mp ->
            configurePlayer(mp)
            mp.addOnRoutingChangedListener(routingListener, mainHandler)
            mp.setOnPreparedListener { preparedMp ->
                isPrepared = true
                durationMs = if (preparedMp.duration > 0) preparedMp.duration.toLong() else 180_000L
                applyPreferredDevice(preparedMp)
                preparedMp.setVolume(volumeLevel, volumeLevel)
                val durSec = durationMs / 1000.0
                listener?.onAudioEvent("canplay", 0.0, durSec)
                if (autoPlayPending) {
                    autoPlayPending = false
                    requestAudioFocus()
                    preparedMp.start()
                    emitPlayState(isPlaying = true)
                }
            }
            mp.setOnCompletionListener {
                mainHandler.removeCallbacks(tickRunnable)
                val durSec = durationMs / 1000.0
                updateSessionAndNotification(false)
                listener?.onAudioEvent("ended", durSec, durSec)
            }
            mp.setOnBufferingUpdateListener { _, _ -> }
            mp.setOnInfoListener { _, what, _ ->
                if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) {
                    listener?.onAudioEvent("waiting", currentPosSec(), durationMs / 1000.0)
                } else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END) {
                    listener?.onAudioEvent("playing", currentPosSec(), durationMs / 1000.0)
                }
                false
            }
            mp.setOnErrorListener { _, _, _ ->
                isPrepared = false
                autoPlayPending = false
                mainHandler.removeCallbacks(tickRunnable)
                updateSessionAndNotification(false)
                listener?.onAudioEvent("error", 0.0, 0.0)
                true
            }
            mediaPlayer = mp
        }
    }

    private fun configurePlayer(mp: MediaPlayer) {
        mp.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
        mp.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
        )
        mp.setVolume(volumeLevel, volumeLevel)
        applyPreferredDevice(mp)
    }

    private fun applyPreferredDevice(mp: MediaPlayer) {
        val prefId = preferredDeviceId
        if (prefId == null) {
            try {
                mp.preferredDevice = null
            } catch (_: Exception) {
            }
            return
        }
        val target = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.id == prefId }
        if (target != null) {
            try {
                mp.preferredDevice = target
            } catch (_: Exception) {
            }
        }
    }

    private fun emitPlayState(isPlaying: Boolean) {
        val pos = currentPosSec()
        val dur = durationMs / 1000.0
        updateSessionAndNotification(isPlaying)
        if (isPlaying) {
            listener?.onAudioEvent("play", pos, dur)
            listener?.onAudioEvent("playing", pos, dur)
            mainHandler.removeCallbacks(tickRunnable)
            mainHandler.postDelayed(tickRunnable, 200L)
        } else {
            mainHandler.removeCallbacks(tickRunnable)
            listener?.onAudioEvent("pause", pos, dur)
        }
    }

    private fun currentPosSec(): Double {
        val mp = mediaPlayer ?: return 0.0
        if (!isPrepared) return 0.0
        return try {
            mp.currentPosition / 1000.0
        } catch (_: Exception) {
            0.0
        }
    }

    private fun requestAudioFocus() {
        val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
            .build()
            .also { focusRequest = it }
        audioManager.requestAudioFocus(req)
    }

    private fun abandonAudioFocus() {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    }

    private fun releasePlayer() {
        val mp = mediaPlayer ?: return
        mediaPlayer = null
        try {
            mp.removeOnRoutingChangedListener(routingListener)
        } catch (_: Exception) {
        }
        try {
            mp.release()
        } catch (_: Exception) {
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "AUREL Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Now Playing controls for AUREL"
                setShowBadge(false)
            }
            notificationManager.createNotificationChannel(ch)
        }
    }

    private fun updateSessionAndNotification(isPlaying: Boolean) {
        val posMs = try {
            if (isPrepared) mediaPlayer?.currentPosition?.toLong() ?: 0L else 0L
        } catch (_: Exception) {
            0L
        }
        val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO

        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setState(state, posMs, if (isPlaying) 1f else 0f)
                .setActions(actions)
                .build()
        )
        mediaSession.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, curTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, curArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, curAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .apply {
                    curArtBitmap?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
                }
                .build()
        )

        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_aurel)
            .setContentTitle(curTitle)
            .setContentText(curArtist)
            .setLargeIcon(curArtBitmap)
            .setContentIntent(openIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .addAction(android.R.drawable.ic_media_previous, "Previous", serviceActionIntent(ACTION_PREV, 1))
            .addAction(
                if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (isPlaying) "Pause" else "Play",
                serviceActionIntent(if (isPlaying) ACTION_PAUSE else ACTION_PLAY, 2)
            )
            .addAction(android.R.drawable.ic_media_next, "Next", serviceActionIntent(ACTION_NEXT, 3))
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()

        if (!isForegroundStarted && isPlaying) {
            isForegroundStarted = true
            val fgsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIF_ID, notif, fgsType)
        } else if (isForegroundStarted || isPlaying) {
            notificationManager.notify(NOTIF_ID, notif)
        }
    }

    private fun serviceActionIntent(action: String, code: Int): PendingIntent {
        val intent = Intent(this, AurelPlaybackService::class.java).setAction(action)
        return PendingIntent.getService(
            this,
            code,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun fetchBitmap(urlStr: String): Bitmap? {
        return try {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 5000
                doInput = true
            }
            conn.inputStream.use { BitmapFactory.decodeStream(it) }
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val CHANNEL_ID = "aurel_playback"
        private const val NOTIF_ID = 1001
        private const val ACTION_PLAY = "app.antideploy.aurel.PLAY"
        private const val ACTION_PAUSE = "app.antideploy.aurel.PAUSE"
        private const val ACTION_NEXT = "app.antideploy.aurel.NEXT"
        private const val ACTION_PREV = "app.antideploy.aurel.PREV"
    }
}
