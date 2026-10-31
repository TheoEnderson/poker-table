import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { NetworkInfo } from '@poker-table/protocol';
import { request } from '../lib/api';

export function Invite({ code }: { code: string }) {
  const [network, setNetwork] = useState<NetworkInfo | null>(null), [origin, setOrigin] = useState(''), [qr, setQr] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<NetworkInfo>('/api/network').then(info => {
      if (!active) return;
      setNetwork(info);
      const current = info.addresses.find(a => a.address === location.hostname);
      setOrigin(current?.url ?? info.addresses[0]?.url ?? '');
    }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, []);
  const link = origin ? `${origin}/join/${code}` : '';
  useEffect(() => {
    let active = true;
    setQr('');
    if (link) void QRCode.toDataURL(link, { width: 220, margin: 2, color: { dark: '#102923', light: '#ffffff' } }).then(value => { if (active) setQr(value); }).catch(() => { if (active) setError('Não foi possível gerar o QR. Use o link abaixo.'); });
    return () => { active = false; };
  }, [link]);
  return <section className="panel invite"><div className="section-heading"><span className="eyebrow">JOGUE JUNTO</span><h2>Convide a mesa</h2></div><p>Todos devem estar no mesmo Wi-Fi. A câmera do celular abre este convite.</p>
    {network && network.addresses.length > 0 && <label>Endereço da rede<select value={origin} onChange={e => setOrigin(e.target.value)}>{network.addresses.map(a => <option key={a.url} value={a.url}>{a.address} · {a.name}</option>)}</select></label>}
    {network?.addresses.length === 0 && <p className="notice">Nenhum IPv4 de rede disponível. Conecte o servidor ao Wi-Fi ou cabo e reabra esta tela.</p>}
    {qr && <img className="qr" width="220" height="220" src={qr} alt={`QR Code para entrar na mesa ${code}`} />}
    {link && <label>Link de convite<input readOnly value={link} onFocus={e => e.target.select()} aria-label="Link de convite" /><small>Toque no link para selecionar e copiar.</small></label>}
    <div className="invite-code"><small>Ou informe o código no site local</small><strong>{code}</strong></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
