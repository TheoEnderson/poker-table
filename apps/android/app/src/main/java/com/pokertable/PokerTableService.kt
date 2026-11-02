package com.pokertable

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground Service que executa o servidor local em um processo isolado (:server).
 * Garante que a partida continue ativa mesmo com o celular bloqueado ou em segundo plano.
 */
class PokerTableService : Service() {

    companion object {
        private const val TAG = "PokerTable:Service"
        const val NOTIFICATION_ID = 1001
        const val CHANNEL_ID = "poker_table_foreground_channel"

        const val ACTION_START = "com.pokertable.action.START"
        const val ACTION_STOP = "com.pokertable.action.STOP"
        const val ACTION_QUERY_STATUS = "com.pokertable.action.QUERY_STATUS"
        const val ACTION_STATUS_BROADCAST = "com.pokertable.action.STATUS_BROADCAST"
        const val ACTION_UPDATE_LAN_IP = "com.pokertable.action.UPDATE_LAN_IP"

        const val EXTRA_LAN_IP = "extra_lan_ip"
        const val EXTRA_PORT = "extra_port"
        const val EXTRA_STATUS = "extra_status"
        const val EXTRA_URL = "extra_url"

        const val STATUS_STOPPED = "STOPPED"
        const val STATUS_STARTING = "STARTING"
        const val STATUS_RUNNING = "RUNNING"
        const val STATUS_STOPPING = "STOPPING"
        const val STATUS_ERROR = "ERROR"

        var currentStatus = STATUS_STOPPED
            private set
        var currentUrl: String = ""
            private set
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var activePort = 3000
    private var activeLanIp: String? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLock()
        Log.i(TAG, "PokerTableService criado no processo :server")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_QUERY_STATUS -> {
                Log.i(TAG, "Recebida consulta de status: $currentStatus ($currentUrl)")
                updateStatus(currentStatus, currentUrl)
                return START_NOT_STICKY
            }
            ACTION_STOP -> {
                Log.i(TAG, "Recebido comando de parada do serviço")
                stopServerInternal()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE_LAN_IP -> {
                val newIp = intent.getStringExtra(EXTRA_LAN_IP)
                Log.i(TAG, "Recebida atualização de LAN IP: $newIp (anterior: $activeLanIp)")
                activeLanIp = newIp
                val displayHost = activeLanIp ?: "localhost"
                currentUrl = "http://$displayHost:$activePort"
                if (currentStatus == STATUS_RUNNING) {
                    val activeNotification = buildNotification("Servidor local ativo em $displayHost:$activePort")
                    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    manager.notify(NOTIFICATION_ID, activeNotification)
                    updateStatus(STATUS_RUNNING, currentUrl)
                }
                return START_NOT_STICKY
            }
            ACTION_START -> {
                if (currentStatus == STATUS_RUNNING && NodeRunner.isRunning()) {
                    Log.i(TAG, "Servidor já em execução em $currentUrl. Reenviando status.")
                    updateStatus(STATUS_RUNNING, currentUrl)
                    return START_STICKY
                }
                activePort = intent.getIntExtra(EXTRA_PORT, 3000)
                activeLanIp = intent.getStringExtra(EXTRA_LAN_IP)
                startServerInternal()
            }
        }
        return START_STICKY
    }

    private fun startServerInternal() {
        val displayHost = activeLanIp ?: "localhost"
        currentUrl = "http://$displayHost:$activePort"
        updateStatus(STATUS_STARTING, currentUrl)

        val notification = buildNotification("Iniciando servidor local…")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        NodeRunner.start(this, activePort, activeLanIp) { success ->
            if (success) {
                Log.i(TAG, "Servidor pronto em $currentUrl")
                updateStatus(STATUS_RUNNING, currentUrl)
                val activeNotification = buildNotification("Servidor local ativo em $displayHost:$activePort")
                val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(NOTIFICATION_ID, activeNotification)
            } else {
                Log.e(TAG, "Falha ao inicializar o servidor")
                updateStatus(STATUS_ERROR, "")
                stopSelf()
            }
        }
    }

    private fun stopServerInternal() {
        updateStatus(STATUS_STOPPING, currentUrl)
        NodeRunner.stop()
        updateStatus(STATUS_STOPPED, "")
        releaseWakeLock()

        // Como o V8/Node.js nativo não permite reinicializações no mesmo processo do SO,
        // o encerramento do processo isolado (:server) garante que uma próxima partida
        // inicie em um espaço de memória 100% limpo, sem afetar a MainActivity.
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancel(NOTIFICATION_ID)
        } catch (_: Exception) {}

        Thread {
            try {
                Thread.sleep(300) // Breve intervalo para entrega do broadcast
                android.os.Process.killProcess(android.os.Process.myPid())
            } catch (_: Exception) {}
        }.start()
    }

    private fun updateStatus(status: String, url: String) {
        currentStatus = status
        currentUrl = url
        val broadcastIntent = Intent(ACTION_STATUS_BROADCAST).apply {
            putExtra(EXTRA_STATUS, status)
            putExtra(EXTRA_URL, url)
            setPackage(packageName)
        }
        sendBroadcast(broadcastIntent)
    }

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "PokerTable:ServerWakeLock"
            ).apply {
                setReferenceCounted(false)
                acquire(12 * 60 * 60 * 1000L) // Limite de segurança de 12 horas
            }
            Log.i(TAG, "WakeLock parcial adquirido com sucesso")
        } catch (e: Exception) {
            Log.w(TAG, "Não foi possível adquirir WakeLock", e)
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
                Log.i(TAG, "WakeLock liberado")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Erro ao liberar WakeLock", e)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_desc)
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(contentText: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, PokerTableService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_poker_chip)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(contentText)
            .setOngoing(true)
            .setContentIntent(openPendingIntent)
            .addAction(
                android.R.drawable.ic_menu_view,
                getString(R.string.notification_action_open),
                openPendingIntent
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                getString(R.string.notification_action_stop),
                stopPendingIntent
            )
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        stopServerInternal()
        releaseWakeLock()
        super.onDestroy()
        Log.i(TAG, "PokerTableService destruído")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
