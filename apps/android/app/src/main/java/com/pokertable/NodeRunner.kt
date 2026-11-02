package com.pokertable

import android.content.Context
import android.system.Os
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Gerencia a preparação de assets, configuração de ambiente e execução
 * do runtime nativo Node.js (via NodeBridge / libnode.so).
 */
object NodeRunner {

    private const val TAG = "PokerTable:NodeRunner"
    private const val ASSETS_PROJECT_DIR = "nodejs-project"
    private val isRunning = AtomicBoolean(false)
    private var workerThread: Thread? = null

    /**
     * Extrai os assets empacotados para o armazenamento interno privado do aplicativo.
     * Utiliza verificação de versão para evitar reextração desnecessária em reinicializações normais.
     */
    fun prepareProjectFiles(context: Context): File {
        val targetDir = File(context.filesDir, ASSETS_PROJECT_DIR)
        val dataDir = File(context.filesDir, "data")
        if (!dataDir.exists()) {
            dataDir.mkdirs()
        }

        val versionMarker = File(targetDir, ".version_installed")
        val currentVersion = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrDefault("0.2.0")

        if (versionMarker.exists() && versionMarker.readText().trim() == currentVersion) {
            Log.i(TAG, "Assets do projeto já extraídos e atualizados (versão $currentVersion)")
            return targetDir
        }

        Log.i(TAG, "Extraindo assets do projeto para: ${targetDir.absolutePath}")
        targetDir.deleteRecursively()
        targetDir.mkdirs()

        copyAssetFolder(context, ASSETS_PROJECT_DIR, targetDir)
        runCatching { versionMarker.writeText(currentVersion) }

        return targetDir
    }

    private fun copyAssetFolder(context: Context, assetPath: String, targetDir: File) {
        val assetManager = context.assets
        val assets = assetManager.list(assetPath) ?: return

        if (assets.isEmpty()) {
            copyAssetFile(context, assetPath, File(targetDir, File(assetPath).name))
        } else {
            for (asset in assets) {
                val subAssetPath = if (assetPath.isEmpty()) asset else "$assetPath/$asset"
                val subTargetDir = File(targetDir, asset)
                val subList = assetManager.list(subAssetPath)
                if (subList != null && subList.isNotEmpty()) {
                    subTargetDir.mkdirs()
                    copyAssetFolder(context, subAssetPath, subTargetDir)
                } else {
                    copyAssetFile(context, subAssetPath, subTargetDir)
                }
            }
        }
    }

    private fun copyAssetFile(context: Context, assetPath: String, destinationFile: File) {
        try {
            destinationFile.parentFile?.mkdirs()
            context.assets.open(assetPath).use { input ->
                FileOutputStream(destinationFile).use { output ->
                    input.copyTo(output)
                }
            }
        } catch (e: IOException) {
            Log.e(TAG, "Erro ao extrair asset: $assetPath -> ${destinationFile.path}", e)
        }
    }

    /**
     * Inicia o servidor Node.js utilizando o runtime nativo incorporado (libnode.so).
     */
    @Synchronized
    fun start(
        context: Context,
        port: Int = 3000,
        lanIp: String? = null,
        onReady: (Boolean) -> Unit
    ) {
        if (isRunning.get()) {
            Log.w(TAG, "Servidor já está em execução")
            onReady(true)
            return
        }

        if (!NodeBridge.isNativeLoaded()) {
            val error = NodeBridge.getLoadError()
            Log.e(TAG, "Falha crítica: runtime nativo Node.js não carregado: ${error?.message}", error)
            onReady(false)
            return
        }

        val thread = Thread({
            try {
                val projectDir = prepareProjectFiles(context)
                val dbFile = File(context.filesDir, "data/poker-table.sqlite")
                val webDir = File(projectDir, "web")
                val mainScript = File(projectDir, "server/main.js")

                Log.i(TAG, "Configurando variáveis de ambiente POSIX para Node.js nativo:")
                Log.i(TAG, "  DATABASE_PATH: ${dbFile.absolutePath}")
                Log.i(TAG, "  WEB_DIRECTORY: ${webDir.absolutePath}")
                Log.i(TAG, "  PORT: $port")
                Log.i(TAG, "  LAN_IP: ${lanIp ?: "auto"}")

                // Configura as variáveis de ambiente no processo libc usando caminhos absolutos
                try {
                    Os.setenv("PORT", port.toString(), true)
                    Os.setenv("HOST", "0.0.0.0", true)
                    Os.setenv("NODE_ENV", "production", true)
                    Os.setenv("DATABASE_PATH", dbFile.absolutePath, true)
                    Os.setenv("WEB_DIRECTORY", webDir.absolutePath, true)
                    if (!lanIp.isNullOrBlank()) {
                        Os.setenv("LAN_IP", lanIp, true)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Aviso ao configurar ambiente com Os.setenv: ${e.message}")
                }

                // Altera diretório de trabalho no processo isolado :server via JNI C++ (POSIX chdir)
                val changed = NodeBridge.changeWorkingDirectory(projectDir.absolutePath)
                Log.i(TAG, "Alteração de diretório de trabalho no processo :server: sucesso=$changed")

                isRunning.set(true)

                // Dispara thread paralela para monitorar a prontidão do endpoint HTTP
                Thread {
                    val ready = waitForServerHealthy(port, maxAttempts = 30, delayMs = 250)
                    Log.i(TAG, "Verificação de saúde do servidor: pronto=$ready")
                    onReady(ready)
                }.start()

                val nodeArgs = arrayOf(
                    "node",
                    mainScript.absolutePath
                )

                Log.i(TAG, "Invocando NodeBridge.startNodeWithArguments...")
                val exitCode = NodeBridge.startNodeWithArguments(nodeArgs)
                Log.i(TAG, "Node.js finalizou com código $exitCode")

                isRunning.set(false)

            } catch (e: Throwable) {
                Log.e(TAG, "Falha na execução do Node.js", e)
                isRunning.set(false)
                onReady(false)
            }
        }, "PokerTable-NodeThread")

        workerThread = thread
        thread.start()
    }

    /**
     * Interrompe o servidor.
     */
    @Synchronized
    fun stop() {
        isRunning.set(false)
        workerThread = null
    }

    fun isRunning(): Boolean = isRunning.get()

    /**
     * Realiza polling no endpoint de saúde local HTTP.
     */
    fun waitForServerHealthy(port: Int, maxAttempts: Int = 30, delayMs: Long = 250): Boolean {
        for (i in 1..maxAttempts) {
            if (isHealthy(port)) {
                return true
            }
            try {
                Thread.sleep(delayMs)
            } catch (_: InterruptedException) {
                return false
            }
        }
        return false
    }

    fun isHealthy(port: Int = 3000): Boolean {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL("http://127.0.0.1:$port/health")
            connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 500
            connection.readTimeout = 500
            connection.requestMethod = "GET"
            connection.responseCode in 200..299
        } catch (_: Exception) {
            false
        } finally {
            connection?.disconnect()
        }
    }
}
