package com.pokertable

import android.util.Log

/**
 * Ponte JNI entre a JVM do Android e as bibliotecas nativas (libc++_shared.so, libnode.so e libpoker-native.so).
 */
object NodeBridge {

    private const val TAG = "PokerTable:NodeBridge"
    private var isLoaded = false
    private var loadError: Throwable? = null

    init {
        try {
            // 1. Carrega a biblioteca de tempo de execução C++ compartilhada do NDK
            System.loadLibrary("c++_shared")
            // 2. Carrega o runtime Node.js (libnode.so) que depende de libc++_shared.so
            System.loadLibrary("node")
            // 3. Carrega a ponte JNI da aplicação (libpoker-native.so)
            System.loadLibrary("poker-native")

            isLoaded = true
            Log.i(TAG, "Bibliotecas nativas 'libc++_shared.so', 'libnode.so' e 'libpoker-native.so' carregadas com sucesso.")
        } catch (e: Throwable) {
            loadError = e
            isLoaded = false
            Log.e(TAG, "Falha crítica ao carregar bibliotecas nativas: ${e.message}", e)
        }
    }

    fun isNativeLoaded(): Boolean = isLoaded

    fun getLoadError(): Throwable? = loadError

    /**
     * Altera o diretório de trabalho do processo de forma segura usando POSIX chdir() na camada C++.
     * Opera exclusivamente no processo isolado do servidor (:server).
     */
    external fun changeWorkingDirectory(directoryPath: String): Boolean

    /**
     * Executa o runtime Node.js através de node::Start(argc, argv).
     * Esta chamada é bloqueante e executa o event loop do Node.js na thread chamadora.
     */
    external fun startNodeWithArguments(arguments: Array<String>): Int
}
