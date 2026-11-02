import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { NetworkInfo } from '@poker-table/protocol';
import { request } from '../lib/api';

export function Invite({ code }: { code: string }) {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [origin, setOrigin] = useState('');
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    function applyNetwork(info: NetworkInfo) {
      if (!active) return;
      setNetwork(info);

      const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      const current = isLocalhost ? undefined : info.addresses.find(a => a.address === location.hostname);
      const preferredPhysical = info.addresses.find(a => !a.isVirtual) ?? info.addresses[0];

      setOrigin(prev => {
        // Se estiver em localhost/127.0.0.1 (WebView do anfitrião no Android), prioriza sempre o alvo físico da LAN
        if (isLocalhost) {
          return preferredPhysical?.url ?? '';
        }
        // Para clientes externos (outros aparelhos), mantém escolha manual se ela ainda existir na rede
        if (prev && info.addresses.some(a => a.url === prev)) {
          return prev;
        }
        return current?.url ?? preferredPhysical?.url ?? '';
      });
    }

    function fetchNetwork() {
      request<NetworkInfo>('/api/network')
        .then(info => applyNetwork(info))
        .catch(e => { if (active) setError((e as Error).message); });
    }

    fetchNetwork();

    const onFocus = () => fetchNetwork();
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchNetwork(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    (window as unknown as { __refreshNetwork?: () => void }).__refreshNetwork = fetchNetwork;

    // Polling suave enquanto o painel estiver aberto para acompanhar mudanças de hotspot
    const interval = setInterval(fetchNetwork, 4000);

    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
      delete (window as unknown as { __refreshNetwork?: () => void }).__refreshNetwork;
    };
  }, []);

  const link = origin ? `${origin}/join/${code}` : '';

  useEffect(() => {
    let active = true;
    setQr('');
    if (link) {
      void QRCode.toDataURL(link, { width: 220, margin: 2, color: { dark: '#102923', light: '#ffffff' } })
        .then(value => { if (active) setQr(value); })
        .catch(() => { if (active) setError('Não foi possível gerar o QR. Use o link abaixo.'); });
    }
    return () => { active = false; };
  }, [link]);

  const selectedAddress = network?.addresses.find(a => a.url === origin);
  const isVirtualSelected = selectedAddress?.isVirtual === true;

  return (
    <section className="panel invite">
      <div className="section-heading">
        <span className="eyebrow">JOGUE JUNTO</span>
        <h2>Convide a mesa</h2>
      </div>
      <p>Todos devem estar no mesmo Wi-Fi. A câmera do celular abre este convite.</p>
      {network && network.addresses.length > 0 && (
        <label>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Endereço da rede</span>
            <button
              type="button"
              onClick={() => (window as unknown as { __refreshNetwork?: () => void }).__refreshNetwork?.()}
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid currentColor',
                borderRadius: '4px',
                cursor: 'pointer',
                color: 'inherit',
                opacity: 0.8
              }}
            >
              Atualizar redes
            </button>
          </span>
          <select value={origin} onChange={e => setOrigin(e.target.value)}>
            {network.addresses.map(a => (
              <option key={a.url} value={a.url}>
                {a.address} · {a.name}{a.isVirtual ? ' (interface virtual)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {network?.addresses.length === 0 && (
        <p className="notice">Nenhum IPv4 de rede disponível. Conecte o servidor ao Wi-Fi ou cabo e reabra esta tela.</p>
      )}
      {isVirtualSelected && (
        <p className="notice">
          Atenção: A interface selecionada ({selectedAddress?.name}) é virtual e normalmente não é acessível por celulares. Conecte o computador à rede Wi-Fi.
        </p>
      )}
      {qr && <img className="qr" width="220" height="220" src={qr} alt={`QR Code para entrar na mesa ${code}`} />}
      {link && (
        <label>
          Link de convite
          <input readOnly value={link} onFocus={e => e.target.select()} aria-label="Link de convite" />
          <small>Toque no link para selecionar e copiar.</small>
        </label>
      )}
      <div className="invite-code">
        <small>Ou informe o código no site local</small>
        <strong>{code}</strong>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
