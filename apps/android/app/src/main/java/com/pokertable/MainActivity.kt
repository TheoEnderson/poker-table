package com.pokertable

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var layoutHome: ScrollView
    private lateinit var layoutWebViewContainer: LinearLayout
    private lateinit var statusIndicator: View
    private lateinit var tvServerStatus: TextView
    private lateinit var tvServerDetails: TextView
    private lateinit var spnInterfaces: Spinner
    private lateinit var etCustomIp: EditText
    private lateinit var btnDetectIp: Button
    private lateinit var btnCreateTable: Button
    private lateinit var btnStopServer: Button
    private lateinit var btnJoinTable: Button
    private lateinit var layoutJoin: LinearLayout
    private lateinit var etHostAddress: EditText
    private lateinit var btnConnectHost: Button
    private lateinit var btnWebBack: Button
    private lateinit var btnWebReload: Button
    private lateinit var tvWebTitle: TextView
    private lateinit var webView: WebView

    private var currentStatus = PokerTableService.STATUS_STOPPED
    private var activeHostUrl: String? = null
    private var isHosting = false
    private var detectedCandidates = listOf<NetworkHelper.InterfaceCandidate>()
    private var userSelectedIp: String? = null

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == PokerTableService.ACTION_STATUS_BROADCAST) {
                val status = intent.getStringExtra(PokerTableService.EXTRA_STATUS) ?: return
                val url = intent.getStringExtra(PokerTableService.EXTRA_URL) ?: ""
                handleStatusUpdate(status, url)
            }
        }
    }

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        setupWebView()
        setupListeners()
        setupBackNavigation()
        requestNotificationPermissionIfNeeded()
        setupNetworkMonitoring()
        refreshNetworkInterfaces()
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(PokerTableService.ACTION_STATUS_BROADCAST)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statusReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(statusReceiver, filter)
        }
        queryServerStatus()
    }

    override fun onResume() {
        super.onResume()
        queryServerStatus()
    }

    override fun onStop() {
        super.onStop()
        try {
            unregisterReceiver(statusReceiver)
        } catch (_: Exception) {
            // Ignora se não registrado
        }
    }

    override fun onDestroy() {
        unregisterNetworkMonitoring()
        super.onDestroy()
    }

    private fun initViews() {
        layoutHome = findViewById(R.id.layoutHome)
        layoutWebViewContainer = findViewById(R.id.layoutWebViewContainer)
        statusIndicator = findViewById(R.id.statusIndicator)
        tvServerStatus = findViewById(R.id.tvServerStatus)
        tvServerDetails = findViewById(R.id.tvServerDetails)
        spnInterfaces = findViewById(R.id.spnInterfaces)
        etCustomIp = findViewById(R.id.etCustomIp)
        btnDetectIp = findViewById(R.id.btnDetectIp)
        btnCreateTable = findViewById(R.id.btnCreateTable)
        btnStopServer = findViewById(R.id.btnStopServer)
        btnJoinTable = findViewById(R.id.btnJoinTable)
        layoutJoin = findViewById(R.id.layoutJoin)
        etHostAddress = findViewById(R.id.etHostAddress)
        btnConnectHost = findViewById(R.id.btnConnectHost)
        btnWebBack = findViewById(R.id.btnWebBack)
        btnWebReload = findViewById(R.id.btnWebReload)
        tvWebTitle = findViewById(R.id.tvWebTitle)
        webView = findViewById(R.id.webView)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            allowContentAccess = false
        }

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                tvWebTitle.text = "Carregando…"
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                tvWebTitle.text = if (isHosting) "Poker Table (Anfitrião)" else "Poker Table (Convidado)"
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    Toast.makeText(
                        this@MainActivity,
                        "Erro ao conectar com a mesa: ${error?.description}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun setupListeners() {
        btnDetectIp.setOnClickListener {
            refreshNetworkInterfaces()
            Toast.makeText(this, "Redes atualizadas", Toast.LENGTH_SHORT).show()
        }

        btnCreateTable.setOnClickListener {
            if (currentStatus == PokerTableService.STATUS_RUNNING) {
                // Servidor já em execução: reabre a mesa sem reiniciar
                openWebView("http://127.0.0.1:3000", isHost = true)
            } else if (currentStatus == PokerTableService.STATUS_STOPPED || currentStatus == PokerTableService.STATUS_ERROR) {
                startHosting()
            }
        }

        btnStopServer.setOnClickListener {
            showStopServerConfirmationDialog()
        }

        btnJoinTable.setOnClickListener {
            layoutJoin.visibility = if (layoutJoin.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        btnConnectHost.setOnClickListener {
            val address = etHostAddress.text.toString().trim()
            if (address.isBlank()) {
                Toast.makeText(this, "Informe o endereço da mesa (ex: http://10.107.248.23:3000)", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val formattedUrl = if (!address.startsWith("http://") && !address.startsWith("https://")) {
                "http://$address"
            } else {
                address
            }
            openWebView(formattedUrl, isHost = false)
        }

        btnWebBack.setOnClickListener {
            switchToHomeView()
        }

        btnWebReload.setOnClickListener {
            if (isHosting && currentStatus == PokerTableService.STATUS_RUNNING) {
                notifyServerNetworkTarget(getSelectedLanIp())
            }
            webView.reload()
        }

        spnInterfaces.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                // Última opção é sempre "Outro / Inserir IP manualmente"
                val isCustom = position == (parent?.count ?: 0) - 1
                etCustomIp.visibility = if (isCustom) View.VISIBLE else View.GONE

                val selectedIp = getSelectedLanIp()
                userSelectedIp = selectedIp

                if (currentStatus == PokerTableService.STATUS_RUNNING) {
                    notifyServerNetworkTarget(selectedIp)
                    updateServiceLanIp(selectedIp)
                }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        etCustomIp.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                val isCustom = spnInterfaces.selectedItemPosition == spnInterfaces.count - 1
                if (isCustom) {
                    val customIp = s?.toString()?.trim()?.ifBlank { null }
                    userSelectedIp = customIp
                    if (currentStatus == PokerTableService.STATUS_RUNNING) {
                        notifyServerNetworkTarget(customIp)
                        updateServiceLanIp(customIp)
                    }
                }
            }
        })
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (layoutWebViewContainer.visibility == View.VISIBLE) {
                    // Volta ao painel principal nativo mantendo o WebView íntegro em memória
                    switchToHomeView()
                } else {
                    // Minimiza a aplicação sem matar o serviço em primeiro plano
                    moveTaskToBack(true)
                }
            }
        })
    }

    private fun setupNetworkMonitoring() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    runOnUiThread { refreshNetworkInterfaces() }
                }

                override fun onLost(network: Network) {
                    runOnUiThread { refreshNetworkInterfaces() }
                }
            }
            networkCallback = callback
            cm.registerDefaultNetworkCallback(callback)
        } catch (_: Exception) {
            // Permissão de monitoramento não crítica
        }
    }

    private fun unregisterNetworkMonitoring() {
        try {
            networkCallback?.let { callback ->
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                cm?.unregisterNetworkCallback(callback)
            }
        } catch (_: Exception) {}
        networkCallback = null
    }

    private fun refreshNetworkInterfaces() {
        val previousSelectedIp = userSelectedIp ?: getSelectedLanIp()
        detectedCandidates = NetworkHelper.getAvailableLanInterfaces(this)

        val options = mutableListOf<String>()
        val bestIp = NetworkHelper.detectBestLanIp(this)

        if (bestIp != null) {
            options.add(getString(R.string.lbl_network_auto) + " ($bestIp)")
        } else {
            options.add(getString(R.string.lbl_network_auto))
        }

        var matchedIndex = -1
        for (i in detectedCandidates.indices) {
            val candidate = detectedCandidates[i]
            options.add(candidate.getDisplayLabel())
            if (previousSelectedIp != null && candidate.ip == previousSelectedIp) {
                matchedIndex = i + 1
            }
        }

        options.add(getString(R.string.lbl_network_custom))

        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, options)
        spnInterfaces.adapter = adapter

        if (matchedIndex > 0) {
            spnInterfaces.setSelection(matchedIndex)
        } else if (previousSelectedIp != null && previousSelectedIp == bestIp) {
            spnInterfaces.setSelection(0)
        }
    }

    private fun getSelectedLanIp(): String? {
        val selectedIndex = spnInterfaces.selectedItemPosition
        if (selectedIndex <= 0) {
            // Automático
            return NetworkHelper.detectBestLanIp(this)
        }
        val customIndex = spnInterfaces.count - 1
        if (selectedIndex == customIndex) {
            // Manual
            return etCustomIp.text.toString().trim().ifBlank { null }
        }
        // Candidato selecionado (índice - 1 pois 0 é automático)
        val candidate = detectedCandidates.getOrNull(selectedIndex - 1)
        return candidate?.ip
    }

    private fun queryServerStatus() {
        val queryIntent = Intent(this, PokerTableService::class.java).apply {
            action = PokerTableService.ACTION_QUERY_STATUS
        }
        try {
            startService(queryIntent)
        } catch (_: Exception) {}

        // Verificação assíncrona adicional via HTTP health check
        Thread {
            if (NodeRunner.isHealthy(3000)) {
                runOnUiThread {
                    if (currentStatus != PokerTableService.STATUS_RUNNING) {
                        handleStatusUpdate(PokerTableService.STATUS_RUNNING, activeHostUrl ?: "http://127.0.0.1:3000")
                    }
                }
            }
        }.start()
    }

    private fun startHosting() {
        val configuredLanIp = getSelectedLanIp()
        isHosting = true

        updateUiForStatus(PokerTableService.STATUS_STARTING, null)

        val serviceIntent = Intent(this, PokerTableService::class.java).apply {
            action = PokerTableService.ACTION_START
            putExtra(PokerTableService.EXTRA_PORT, 3000)
            putExtra(PokerTableService.EXTRA_LAN_IP, configuredLanIp)
        }
        ContextCompat.startForegroundService(this, serviceIntent)
    }

    private fun stopHosting() {
        val serviceIntent = Intent(this, PokerTableService::class.java).apply {
            action = PokerTableService.ACTION_STOP
        }
        startService(serviceIntent)
        isHosting = false
        updateUiForStatus(PokerTableService.STATUS_STOPPING, null)
    }

    private fun showStopServerConfirmationDialog() {
        AlertDialog.Builder(this)
            .setTitle(R.string.dialog_stop_title)
            .setMessage(R.string.dialog_stop_message)
            .setPositiveButton(R.string.dialog_stop_confirm) { _, _ ->
                stopHosting()
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun handleStatusUpdate(status: String, url: String) {
        currentStatus = status
        updateUiForStatus(status, url)

        if (status == PokerTableService.STATUS_RUNNING) {
            activeHostUrl = url
            if (isHosting) {
                notifyServerNetworkTarget(getSelectedLanIp())
            }
            // Ao iniciar como anfitrião, carrega a mesa local no WebView se ainda não estiver visível
            if (isHosting && layoutWebViewContainer.visibility != View.VISIBLE) {
                openWebView("http://127.0.0.1:3000", isHost = true)
            }
        }
    }

    private fun updateUiForStatus(status: String, url: String?) {
        when (status) {
            PokerTableService.STATUS_RUNNING -> {
                val displayUrl = url ?: activeHostUrl ?: "http://localhost:3000"
                tvServerStatus.text = getString(R.string.status_running)
                tvServerDetails.text = getString(R.string.details_running, displayUrl)
                statusIndicator.setBackgroundColor(ContextCompat.getColor(this, R.color.status_running))

                btnCreateTable.text = getString(R.string.btn_return_to_table)
                btnCreateTable.isEnabled = true
                btnCreateTable.backgroundTintList = ContextCompat.getColorStateList(this, R.color.gold)

                btnStopServer.visibility = View.VISIBLE
                btnStopServer.isEnabled = true
            }
            PokerTableService.STATUS_STARTING -> {
                tvServerStatus.text = getString(R.string.status_starting)
                tvServerDetails.text = getString(R.string.details_starting)
                statusIndicator.setBackgroundColor(ContextCompat.getColor(this, R.color.status_starting))

                btnCreateTable.text = getString(R.string.btn_starting)
                btnCreateTable.isEnabled = false
                btnCreateTable.backgroundTintList = ContextCompat.getColorStateList(this, R.color.gold_disabled)

                btnStopServer.visibility = View.GONE
            }
            PokerTableService.STATUS_STOPPING -> {
                tvServerStatus.text = getString(R.string.status_stopping)
                tvServerDetails.text = getString(R.string.details_stopping)
                statusIndicator.setBackgroundColor(ContextCompat.getColor(this, R.color.status_stopping))

                btnCreateTable.text = getString(R.string.btn_stopping)
                btnCreateTable.isEnabled = false
                btnCreateTable.backgroundTintList = ContextCompat.getColorStateList(this, R.color.gold_disabled)

                btnStopServer.visibility = View.GONE
            }
            PokerTableService.STATUS_STOPPED -> {
                tvServerStatus.text = getString(R.string.status_stopped)
                tvServerDetails.text = getString(R.string.details_stopped)
                statusIndicator.setBackgroundColor(ContextCompat.getColor(this, R.color.status_stopped))

                btnCreateTable.text = getString(R.string.btn_create_table)
                btnCreateTable.isEnabled = true
                btnCreateTable.backgroundTintList = ContextCompat.getColorStateList(this, R.color.gold)

                btnStopServer.visibility = View.GONE
            }
            PokerTableService.STATUS_ERROR -> {
                tvServerStatus.text = getString(R.string.status_error)
                tvServerDetails.text = getString(R.string.details_error)
                statusIndicator.setBackgroundColor(ContextCompat.getColor(this, R.color.danger))

                btnCreateTable.text = getString(R.string.btn_create_table)
                btnCreateTable.isEnabled = true
                btnCreateTable.backgroundTintList = ContextCompat.getColorStateList(this, R.color.gold)

                btnStopServer.visibility = View.GONE
                Toast.makeText(this, "Falha ao inicializar o servidor integrado", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun openWebView(url: String, isHost: Boolean) {
        layoutHome.visibility = View.GONE
        layoutWebViewContainer.visibility = View.VISIBLE
        tvWebTitle.text = if (isHost) "Poker Table (Anfitrião)" else "Poker Table (Convidado)"

        if (isHost && currentStatus == PokerTableService.STATUS_RUNNING) {
            notifyServerNetworkTarget(getSelectedLanIp())
        }

        // Não recarrega o WebView se a URL ativa já for a pretendida (evita perda de estado em navegação rápida)
        val currentUrl = webView.url
        if (currentUrl == null || !currentUrl.startsWith(url.trimEnd('/'))) {
            webView.loadUrl(url)
        } else if (isHost) {
            webView.evaluateJavascript("window.__refreshNetwork && window.__refreshNetwork();", null)
        }
    }

    private fun notifyServerNetworkTarget(targetIp: String?) {
        Thread {
            try {
                val url = java.net.URL("http://127.0.0.1:3000/api/network/target")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                conn.doOutput = true
                conn.connectTimeout = 1500
                conn.readTimeout = 1500
                val body = if (targetIp != null) "{\"target\":\"$targetIp\"}" else "{\"target\":null}"
                conn.outputStream.use { os ->
                    os.write(body.toByteArray(Charsets.UTF_8))
                }
                val responseCode = conn.responseCode
                conn.disconnect()
                runOnUiThread {
                    webView.evaluateJavascript("window.__refreshNetwork && window.__refreshNetwork();", null)
                }
            } catch (_: Exception) {}
        }.start()
    }

    private fun updateServiceLanIp(ip: String?) {
        try {
            val serviceIntent = Intent(this, PokerTableService::class.java).apply {
                action = PokerTableService.ACTION_UPDATE_LAN_IP
                putExtra(PokerTableService.EXTRA_LAN_IP, ip)
            }
            startService(serviceIntent)
        } catch (_: Exception) {}
    }

    private fun switchToHomeView() {
        layoutWebViewContainer.visibility = View.GONE
        layoutHome.visibility = View.VISIBLE
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    101
                )
            }
        }
    }
}
