import type { CommandInput, RoomState } from '@poker-table/protocol';
import { ErrorNotice } from '../Layout';
import { PotSummary } from './PotSummary';
import { SeatStrip } from './SeatStrip';
import { MyStatusPanel } from './MyStatusPanel';
import { ActionDock } from './ActionDock';
import { SettlementBanner } from './SettlementBanner';
import { HostStreetControls } from './HostStreetControls';

export function ActiveTable({
  room,
  selfId,
  status,
  sync,
  disabled,
  error,
  command,
  pending,
}: {
  room: RoomState;
  selfId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'ended';
  sync: () => void;
  disabled: boolean;
  error?: string;
  command: (input: CommandInput) => Promise<boolean>;
  pending: boolean;
}) {
  const game = room.game;
  if (!game) return null;

  const me = room.players.find(p => p.id === selfId);
  const isHost = me?.isHost ?? false;

  return (
    <div className="active-table" aria-label="Mesa de jogo ativa">
      {/* 1. Cabeçalho Compacto Mobile */}
      <header className="active-header">
        <div className="header-meta">
          <div className="table-brand">
            <span className="brand-mark" aria-hidden="true">♠</span>
            <span className="room-title">{room.config.name}</span>
            {isHost && <span className="host-pill" title="Você é o anfitrião da mesa">Host</span>}
          </div>
          <div className="header-code">
            <small>MESA</small>
            <strong>{room.code}</strong>
          </div>
        </div>

        <div className="active-connection-row" role="status">
          <span className={status === 'connected' ? 'connected-dot' : 'offline-dot'} />
          <span className="connection-text">
            {status === 'connected'
              ? 'Conectado · sincronizado'
              : status === 'ended'
                ? 'Sessão encerrada'
                : 'Reconectando à rede local…'}
          </span>
          <button className="text-button sync-btn" onClick={sync} disabled={disabled}>
            Sincronizar
          </button>
        </div>
      </header>

      {/* Notificação de Erro na Área Principal */}
      {error && <ErrorNotice message={error} />}

      {/* 2. Resumo da Mesa (Pote Total e Blinds) */}
      <PotSummary game={game} players={room.players} />

      {/* 3. Fita Horizontal de Jogadores */}
      <SeatStrip game={game} room={room} selfId={selfId} />

      {/* 4. Resumo de Premiações (se a mão foi liquidada ou partida encerrada) */}
      <SettlementBanner game={game} room={room} />

      {/* 5. Painel Pessoal do Jogador */}
      <MyStatusPanel game={game} room={room} selfId={selfId} />

      {/* 6. Controles Administrativos de Street (Exclusivo do Anfitrião) */}
      <HostStreetControls
        game={game}
        room={room}
        selfId={selfId}
        command={command}
        pending={pending}
        disabled={disabled}
      />

      {/* 7. Console de Apostas Mobile-First */}
      <ActionDock
        game={game}
        room={room}
        selfId={selfId}
        command={command}
        pending={pending}
        disabled={disabled}
      />
    </div>
  );
}
