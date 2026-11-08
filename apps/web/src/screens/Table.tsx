import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRoom } from '../hooks/useRoom';
import { forgetSession, loadSession } from '../lib/sessions';
import { ErrorNotice } from '../components/Layout';
import { SeatMap } from '../components/SeatMap';
import { Invite } from '../components/Invite';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ActiveTable } from '../components/table/ActiveTable';
import { HostParticipantsManager } from '../components/HostParticipantsManager';
import type { RoomState } from '@poker-table/protocol';

export function Table({ code }: { code: string }) {
  const credentials = useMemo(() => loadSession(code), [code]);
  const { room, status, error, pending, command, sync } = useRoom(credentials);
  const [confirm, setConfirm] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState<RoomState['players'][number] | null>(null);

  useEffect(() => {
    if (status === 'ended') {
      forgetSession(code);
    }
  }, [status, code]);

  if (!credentials) {
    return (
      <section className="form-page">
        <h1>Entre para participar.</h1>
        <p>Esta mesa ainda não tem uma sessão salva neste navegador.</p>
        <a className="button primary" href={`/join/${code}`}>
          Entrar na mesa
        </a>
      </section>
    );
  }

  if (status === 'ended') {
    return (
      <section className="form-page session-ended-page">
        <h1>Sessão encerrada</h1>
        <ErrorNotice message={error || 'Sua sessão nesta mesa não está mais ativa.'} />
        <p role="status">
          {error.includes('removido')
            ? 'Você foi removido da sala pelo anfitrião. Seu assento foi liberado.'
            : 'Sua sessão nesta mesa foi encerrada. Para participar novamente, entre na mesa com um novo convite.'}
        </p>
        <div className="button-group">
          <a
            className="button primary full"
            href={`/join/${code}`}
            onClick={() => forgetSession(code)}
          >
            Entrar novamente na mesa
          </a>
          <a
            href="/"
            className="button secondary full"
            onClick={() => forgetSession(code)}
          >
            Voltar ao início
          </a>
        </div>
      </section>
    );
  }

  if (!room) {
    return (
      <section className="form-page">
        <h1>Retomando sua mesa…</h1>
        <ErrorNotice message={error} />
        <p role="status">
          {status === 'connecting'
            ? 'Conectando ao servidor local.'
            : 'Confira a rede e se o servidor está ligado.'}
        </p>
        <a href="/" className="button secondary">
          Voltar ao início
        </a>
      </section>
    );
  }

  const me = room.players.find(p => p.id === credentials.playerId);
  const isHost = !!me?.isHost;
  const disabled = status !== 'connected' || pending || room.closed;
  const gameStarted = room.game !== null;
  const inHand = room.game?.hand.players.some(p => p.id === credentials.playerId) ?? false;

  const rename = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name'));
    await command({ type: 'rename', name });
  };

  const finish = async () => {
    if (await command({ type: isHost ? 'close-room' : 'leave' })) {
      forgetSession(code);
      location.assign('/');
    } else {
      setConfirm(false);
    }
  };

  const seatedPlayers = room.players.filter(p => p.seat !== null);
  const seatedCount = seatedPlayers.length;
  const hasDisconnectedSeated = seatedPlayers.some(p => !p.connected);
  const canStartGame = isHost && !gameStarted && seatedCount >= 2 && !hasDisconnectedSeated;
  const startBlockedReason = !isHost || gameStarted
    ? null
    : seatedCount < 2
      ? 'Aguardando pelo menos 2 participantes sentados para iniciar.'
      : hasDisconnectedSeated
        ? 'Aguardando todos os participantes sentados se conectarem.'
        : null;

  return (
    <div className="table-page">
      {gameStarted ? (
        /* Modo Partida Ativa (Mobile-First Console) */
        <>
          <ActiveTable
            room={room}
            selfId={credentials.playerId}
            status={status}
            sync={sync}
            disabled={disabled}
            error={error}
            command={command}
            pending={pending}
          />

          <details className="table-secondary-panel" aria-label="Gerenciamento de Assentos e Perfil">
            <summary className="table-secondary-summary">
              <span>Assentos e Opções da Mesa ▾</span>
            </summary>
            <ErrorNotice message={error} />

            <div className="table-layout">
              <section className="table-panel">
                <div className="table-stats">
                  <div>
                    <small>PARTICIPANTES</small>
                    <strong>
                      {room.players.length}
                      <span> / {room.config.maxPlayers}</span>
                    </strong>
                  </div>
                  <div>
                    <small>FICHAS INICIAIS</small>
                    <strong>{room.config.startingChips.toLocaleString('pt-BR')}</strong>
                  </div>
                  <div>
                    <small>BLINDS</small>
                    <strong>
                      {room.config.smallBlind} / {room.config.bigBlind}
                    </strong>
                  </div>
                </div>

                <SeatMap
                  room={room}
                  selfId={credentials.playerId}
                  disabled={disabled || (gameStarted && me?.seat !== null)}
                  onSelect={seat => void command({ type: 'select-seat', seat })}
                />

                <p className="table-hint">
                  {me?.seat === null
                    ? 'Escolha um assento disponível para entrar na próxima mão.'
                    : 'Partida iniciada. Os assentos estão reservados até o fim da mão.'}
                </p>
              </section>

              <aside>
                <section className="panel profile">
                  <h2>Seu perfil</h2>
                  <form onSubmit={e => void rename(e)}>
                    <label>
                      Seu nome
                      <input
                        key={me?.name}
                        name="name"
                        defaultValue={me?.name}
                        required
                        maxLength={32}
                        disabled={disabled}
                      />
                    </label>
                    <button className="secondary full" type="submit" disabled={disabled}>
                      Salvar nome
                    </button>
                  </form>

                  <button
                    className="danger-quiet full"
                    disabled={disabled || (!isHost && inHand)}
                    onClick={() => setConfirm(true)}
                  >
                    {isHost ? 'Encerrar mesa' : 'Sair definitivamente'}
                  </button>
                </section>
              </aside>
            </div>
          </details>
        </>
      ) : (
        /* Modo Lobby de Preparação */
        <>
          <div className="table-heading">
            <div>
              <span className="eyebrow">{room.closed ? 'MESA ENCERRADA' : 'A MESA ESTÁ ABERTA'}</span>
              <h1>{room.config.name}</h1>
            </div>
            <div className="room-code">
              <small>CÓDIGO DA MESA</small>
              <strong>{room.code}</strong>
            </div>
          </div>

          <div className="connection-bar" role="status">
            <span className={status === 'connected' ? 'connected-dot' : 'offline-dot'} />
            {status === 'connected'
              ? 'Conectado · mesa sincronizada'
              : 'Reconectando… seu lugar está reservado.'}
            <button className="text-button" onClick={sync} disabled={disabled}>
              Sincronizar
            </button>
          </div>

          <ErrorNotice message={error} />

          <div className="table-layout">
            <section className="table-panel">
              <div className="table-stats">
                <div>
                  <small>PARTICIPANTES</small>
                  <strong>
                    {room.players.length}
                    <span> / {room.config.maxPlayers}</span>
                  </strong>
                </div>
                <div>
                  <small>FICHAS INICIAIS</small>
                  <strong>{room.config.startingChips.toLocaleString('pt-BR')}</strong>
                </div>
                <div>
                  <small>BLINDS</small>
                  <strong>
                    {room.config.smallBlind} / {room.config.bigBlind}
                  </strong>
                </div>
              </div>

              {isHost && (
                <div className="lobby-host-action">
                  {canStartGame ? (
                    <button
                      className="primary full lobby-start-btn"
                      disabled={disabled}
                      onClick={() => void command({ type: 'start-game' })}
                    >
                      Iniciar partida ♠
                    </button>
                  ) : startBlockedReason ? (
                    <p className="lobby-start-hint" role="status">
                      <span className="hint-dot" aria-hidden="true" />
                      {startBlockedReason}
                    </p>
                  ) : null}
                </div>
              )}

              <SeatMap
                room={room}
                selfId={credentials.playerId}
                disabled={disabled}
                onSelect={seat => void command({ type: 'select-seat', seat })}
              />

              <p className="table-hint">
                {me?.seat
                  ? `Você está na posição ${me.seat}. Toque em um lugar livre para mudar.`
                  : 'Toque em uma posição livre para se sentar.'}
              </p>

              <div className="waiting-list">
                <h2>Participantes sem posição</h2>
                {room.players.filter(p => p.seat === null).length ? (
                  <ul>
                    {room.players
                      .filter(p => p.seat === null)
                      .map(p => (
                        <li key={p.id}>
                          {p.name}
                          {p.isHost ? ' · anfitrião' : ''}
                          <small>{p.connected ? 'Conectado' : 'Ausente'}</small>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p>Todos já escolheram seu lugar.</p>
                )}
              </div>
            </section>

            <aside>
              <Invite code={room.code} />

              {isHost && (
                <HostParticipantsManager
                  room={room}
                  disabled={disabled}
                  onRemove={player => setPlayerToRemove(player)}
                />
              )}

              <section className="panel profile">
                <h2>Seu lugar à mesa</h2>
                <form onSubmit={e => void rename(e)}>
                  <label>
                    Seu nome
                    <input
                      key={me?.name}
                      name="name"
                      defaultValue={me?.name}
                      required
                      maxLength={32}
                      disabled={disabled}
                    />
                  </label>
                  <button className="secondary full" type="submit" disabled={disabled}>
                    Salvar nome
                  </button>
                </form>

                {me?.seat && (
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => void command({ type: 'select-seat', seat: null })}
                  >
                    Liberar minha posição
                  </button>
                )}

                <p className="form-help">
                  Pode fechar esta aba sem sair. Sua identidade e posição ficam reservadas.
                </p>

                <button
                  className="danger-quiet full"
                  disabled={disabled}
                  onClick={() => setConfirm(true)}
                >
                  {isHost ? 'Encerrar mesa' : 'Sair definitivamente'}
                </button>

                {room.closed && (
                  <a href="/" className="button secondary full">
                    Voltar ao início
                  </a>
                )}
              </section>
            </aside>
          </div>

          <p className="stage-note">
            Sala de preparação · As configurações estão salvas. Apostas e regras de poker chegam em uma próxima etapa.
          </p>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={isHost ? 'Encerrar a mesa?' : 'Sair definitivamente?'}
        description={
          isHost
            ? 'A mesa será encerrada para todos. Para voltar depois, basta cancelar e fechar esta aba.'
            : 'Seu lugar será liberado e esta sessão deixará de funcionar. Para apenas desconectar, feche a aba.'
        }
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void finish()}
      />

      <ConfirmDialog
        open={playerToRemove !== null}
        title={`Remover ${playerToRemove?.name}?`}
        description={`Remover ${playerToRemove?.name} da sala? O assento será liberado e o jogador precisará entrar novamente para participar.`}
        confirmLabel="Remover jogador"
        pending={pending}
        onCancel={() => setPlayerToRemove(null)}
        onConfirm={async () => {
          if (playerToRemove) {
            await command({ type: 'remove-player', playerId: playerToRemove.id });
            setPlayerToRemove(null);
          }
        }}
      />
    </div>
  );
}
