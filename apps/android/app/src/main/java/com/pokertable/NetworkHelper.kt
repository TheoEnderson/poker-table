package com.pokertable

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

/**
 * Utilitário para detecção, classificação honesta e seleção de interfaces de rede no Android.
 *
 * Diretrizes (Etapa 5B.3):
 * - Diferencia com evidência real Wi-Fi conectada (como cliente de roteador) de Hotspot/Ponto de acesso.
 * - Não assume que toda interface wireless (wlan0, wlan1) é hotspot com falsa certeza.
 * - Prioriza interfaces de ponto de acesso quando ativas, preservando a rede Wi-Fi doméstica como alternativa.
 * - Exclui interfaces celulares de dados móveis (rmnet, pdp, ccmni) e virtuais (lo, tun, dummy).
 */
object NetworkHelper {

    enum class NetworkClassification {
        WIFI_CONNECTED,
        HOTSPOT_PROBABLE,
        ETHERNET,
        WIRELESS_LAN,
        OTHER_LAN
    }

    data class InterfaceCandidate(
        val name: String,
        val ip: String,
        val classification: NetworkClassification,
        val description: String
    ) {
        val isLikelyHotspot: Boolean
            get() = classification == NetworkClassification.HOTSPOT_PROBABLE

        fun getDisplayLabel(): String {
            return "$ip · $name ($description)"
        }
    }

    private val EXCLUDED_PREFIXES = listOf("rmnet", "pdp", "dummy", "ccmni", "lo", "tun", "veth", "docker", "br-")

    /**
     * Retorna a lista de interfaces de rede física ativas e acessíveis na LAN,
     * classificadas com base no estado real de conectividade do sistema operacional Android.
     */
    fun getAvailableLanInterfaces(context: Context? = null): List<InterfaceCandidate> {
        val activeWifiInterfaces = mutableSetOf<String>()
        val activeWifiIps = mutableSetOf<String>()

        if (context != null) {
            try {
                val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                if (cm != null) {
                    val networks = cm.allNetworks
                    for (network in networks) {
                        val caps = cm.getNetworkCapabilities(network) ?: continue
                        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                            val linkProps = cm.getLinkProperties(network) ?: continue
                            linkProps.interfaceName?.let { activeWifiInterfaces.add(it) }
                            for (linkAddr in linkProps.linkAddresses) {
                                val host = linkAddr.address?.hostAddress
                                if (!host.isNullOrBlank()) activeWifiIps.add(host)
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // Fallback seguro caso haja restrições ou exceção de conectividade
            }
        }

        val candidates = mutableListOf<InterfaceCandidate>()

        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (intf in interfaces) {
                if (!intf.isUp || intf.isLoopback) continue
                val nameLower = intf.name.lowercase()
                if (EXCLUDED_PREFIXES.any { nameLower.startsWith(it) }) continue

                val addresses = Collections.list(intf.inetAddresses)
                for (addr in addresses) {
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress ?: continue

                        val (classification, description) = classifyInterface(
                            name = intf.name,
                            ip = ip,
                            activeWifiInterfaces = activeWifiInterfaces,
                            activeWifiIps = activeWifiIps
                        )

                        candidates.add(InterfaceCandidate(intf.name, ip, classification, description))
                    }
                }
            }
        } catch (_: Exception) {
            // Falha segura
        }

        return candidates.sortedWith(
            compareBy<InterfaceCandidate> { priorityOrder(it.classification) }
                .thenBy { it.name }
        )
    }

    private fun classifyInterface(
        name: String,
        ip: String,
        activeWifiInterfaces: Set<String>,
        activeWifiIps: Set<String>
    ): Pair<NetworkClassification, String> {
        val nameLower = name.lowercase()

        // 1. Evidência direta de rede Wi-Fi conectada via ConnectivityManager
        if (activeWifiInterfaces.contains(name) || activeWifiIps.contains(ip)) {
            return Pair(NetworkClassification.WIFI_CONNECTED, "Wi-Fi conectada")
        }

        // 2. Interfaces com nomenclatura explícita de SoftAP / Hotspot
        if (nameLower.startsWith("ap") || nameLower.startsWith("softap") || nameLower.startsWith("swlan")) {
            return Pair(NetworkClassification.HOTSPOT_PROBABLE, "Ponto de acesso / Hotspot")
        }

        // 3. Tethering USB
        if (nameLower.startsWith("rndis")) {
            return Pair(NetworkClassification.HOTSPOT_PROBABLE, "Tethering USB")
        }

        // 4. Interfaces sem fio genéricas (wlan*)
        if (nameLower.startsWith("wlan") || nameLower.startsWith("wifi")) {
            // Se outra interface Wi-Fi já foi comprovada como cliente OU se o IP está em faixa típica de tethering
            val isKnownTetheringSubnet = ip.startsWith("10.107.") || // Xiaomi Hotspot padrão
                ip.startsWith("192.168.43.") ||                     // AOSP Hotspot padrão
                ip.startsWith("172.20.10.")                        // Faixa tethering alternativa

            return if (activeWifiInterfaces.isNotEmpty() || isKnownTetheringSubnet) {
                Pair(NetworkClassification.HOTSPOT_PROBABLE, "Ponto de acesso / Hotspot provável")
            } else {
                Pair(NetworkClassification.WIRELESS_LAN, "Interface sem fio")
            }
        }

        // 5. Conexões cabeadas
        if (nameLower.startsWith("eth") || nameLower.startsWith("en")) {
            return Pair(NetworkClassification.ETHERNET, "Rede cabeada")
        }

        return Pair(NetworkClassification.OTHER_LAN, "Rede local")
    }

    private fun priorityOrder(classification: NetworkClassification): Int {
        return when (classification) {
            NetworkClassification.HOTSPOT_PROBABLE -> 0 // Hotspot primeiro para partidas locais offline
            NetworkClassification.WIFI_CONNECTED -> 1  // Wi-Fi conectada segundo
            NetworkClassification.WIRELESS_LAN -> 2    // Interface sem fio genérica
            NetworkClassification.ETHERNET -> 3        // Rede cabeada
            NetworkClassification.OTHER_LAN -> 4       // Outras redes físicas
        }
    }

    /**
     * Retorna o endereço IP mais adequado para anúncio no QR Code e no servidor local.
     */
    fun detectBestLanIp(context: Context? = null): String? {
        val interfaces = getAvailableLanInterfaces(context)
        return interfaces.firstOrNull()?.ip
    }

    /**
     * Resume as interfaces detectadas em texto legível para o usuário.
     */
    fun formatInterfacesSummary(interfaces: List<InterfaceCandidate>): String {
        if (interfaces.isEmpty()) {
            return "Nenhuma rede Wi-Fi/Hotspot ativa detectada (usando 127.0.0.1)"
        }
        return interfaces.joinToString("\n") { it.getDisplayLabel() }
    }
}
