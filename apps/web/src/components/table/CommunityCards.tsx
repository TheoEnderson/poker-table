import type { GameState } from '@poker-table/protocol';

export function CommunityCards({ game }: { game: GameState }) {
  const { street, status } = game.hand;
  const isSettled = game.status === 'hand-settled' || game.status === 'game-complete';

  // Determina quantas cartas comunitárias estão reveladas
  let revealedCount = 0;
  let statusText = 'Pré-flop · Cartas na mesa física';

  if (isSettled || status === 'showdown') {
    revealedCount = 5;
    statusText = 'Showdown · Revelação física';
  } else if (status === 'hand_ended_by_fold') {
    // Se a mão acabou por fold, mantém as cartas da street em que parou
    if (street === 'preflop') {
      revealedCount = 0;
      statusText = 'Mão encerrada no Pré-flop';
    } else if (street === 'flop') {
      revealedCount = 3;
      statusText = 'Mão encerrada no Flop';
    } else if (street === 'turn') {
      revealedCount = 4;
      statusText = 'Mão encerrada no Turn';
    } else {
      revealedCount = 5;
      statusText = 'Mão encerrada no River';
    }
  } else {
    switch (street) {
      case 'preflop':
        revealedCount = 0;
        statusText = 'Pré-flop · Cartas na mesa física';
        break;
      case 'flop':
        revealedCount = 3;
        statusText = 'Flop · 3 cartas na mesa física';
        break;
      case 'turn':
        revealedCount = 4;
        statusText = 'Turn · 4 cartas na mesa física';
        break;
      case 'river':
        revealedCount = 5;
        statusText = 'River · 5 cartas na mesa física';
        break;
    }
  }

  const slots = [0, 1, 2, 3, 4];

  return (
    <div className="community-cards-container" aria-label="Cartas comunitárias da mesa física">
      <div className="community-cards-slots" role="group" aria-label={`5 cartas comunitárias, ${revealedCount} reveladas`}>
        {slots.map(index => {
          const isRevealed = index < revealedCount;
          return (
            <div
              key={index}
              className={`community-card-slot ${isRevealed ? 'slot-revealed' : 'slot-hidden'}`}
              title={isRevealed ? `Carta comunitária #${index + 1} (revelada na mesa física)` : `Espaço #${index + 1} (aguardando revelação física)`}
            >
              {isRevealed ? (
                <div className="symbolic-board-card" aria-hidden="true">
                  <div className="card-inner-frame">
                    <svg
                      viewBox="0 0 24 34"
                      className="card-geometric-pattern"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      {/* Moldura geométrica estilo filigrana clássica */}
                      <rect
                        x="2"
                        y="2"
                        width="20"
                        height="30"
                        rx="1.5"
                        stroke="#c49d48"
                        strokeWidth="0.8"
                        strokeDasharray="2 1.5"
                        opacity="0.75"
                      />
                      {/* Losango geométrico central abstrato (sem naipes nem valores virtuais) */}
                      <path
                        d="M12 9.5 L17 17 L12 24.5 L7 17 Z"
                        stroke="#b88d3b"
                        strokeWidth="0.9"
                        fill="#eddcb2"
                        fillOpacity="0.35"
                      />
                      <circle cx="12" cy="17" r="1.8" fill="#b88d3b" opacity="0.8" />
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="symbolic-empty-slot" aria-hidden="true">
                  <span className="empty-slot-mark">·</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="community-cards-caption">
        <span className="community-status-badge">{statusText}</span>
      </div>
    </div>
  );
}
