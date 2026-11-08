import { useEffect, useState, useMemo } from 'react';
import { getBetPresets, type BetPreset } from '../../utils/betting';

export function RaiseControl({
  minRaiseAmount,
  maxRaiseAmount,
  minRaiseIncrement,
  playerRoundCommitted,
  playerChips,
  pot,
  currentBet,
  isBet = false,
  disabled,
  onConfirm,
  onCancel,
}: {
  minRaiseAmount: number;
  maxRaiseAmount: number;
  minRaiseIncrement: number;
  playerRoundCommitted: number;
  playerChips: number;
  pot: number;
  currentBet: number;
  isBet?: boolean;
  disabled: boolean;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
}) {
  const [inputValue, setInputValue] = useState<string>(String(minRaiseAmount));

  // Sincroniza e reseta a seleção se qualquer limite ou estado financeiro da mesa mudar
  useEffect(() => {
    setInputValue(String(minRaiseAmount));
  }, [minRaiseAmount, maxRaiseAmount, currentBet, playerRoundCommitted, playerChips]);

  const step = minRaiseIncrement > 0 ? minRaiseIncrement : 1;
  const sliderStep =
    minRaiseIncrement > 1 && (maxRaiseAmount - minRaiseAmount) % minRaiseIncrement === 0
      ? minRaiseIncrement
      : 1;

  const presets = useMemo<BetPreset[]>(() => {
    return getBetPresets({
      pot,
      currentBet,
      playerRoundCommitted,
      minRaiseAmount,
      maxRaiseAmount,
    });
  }, [pot, currentBet, playerRoundCommitted, minRaiseAmount, maxRaiseAmount]);

  const trimmed = inputValue.trim();
  const isStrictInt = /^\d+$/.test(trimmed);
  const parsed = isStrictInt ? Number(trimmed) : null;
  const isSafeInt = parsed !== null && Number.isSafeInteger(parsed);

  let validationError: string | null = null;
  if (trimmed === '') {
    validationError = isBet
      ? 'Informe um valor para a aposta.'
      : 'Informe um valor para o aumento.';
  } else if (!isStrictInt || !isSafeInt) {
    validationError = 'O valor deve ser um número inteiro, sem casas decimais.';
  } else if (parsed < minRaiseAmount) {
    validationError = `O valor mínimo é ${minRaiseAmount.toLocaleString('pt-BR')}.`;
  } else if (parsed > maxRaiseAmount) {
    validationError = `O valor máximo disponível é ${maxRaiseAmount.toLocaleString('pt-BR')}.`;
  } else if (parsed - playerRoundCommitted > playerChips) {
    validationError = 'Fichas insuficientes no seu stack.';
  }

  const isValid = validationError === null && parsed !== null;
  const parsedAmount = isValid ? parsed : null;
  const isAllIn = parsedAmount === maxRaiseAmount;
  const extraNeeded =
    parsedAmount !== null ? Math.max(0, parsedAmount - playerRoundCommitted) : null;

  // Cálculo da porcentagem para preenchimento visual do slider
  const currentNumeric = parsed ?? minRaiseAmount;
  const fillPercent =
    maxRaiseAmount > minRaiseAmount
      ? Math.min(
          100,
          Math.max(
            0,
            ((currentNumeric - minRaiseAmount) / (maxRaiseAmount - minRaiseAmount)) * 100,
          ),
        )
      : 0;

  const handleDecrease = () => {
    const base = isSafeInt && parsed !== null ? parsed : minRaiseAmount;
    const nextVal = Math.max(minRaiseAmount, base - step);
    setInputValue(String(nextVal));
  };

  const handleIncrease = () => {
    const base = isSafeInt && parsed !== null ? parsed : minRaiseAmount;
    const nextVal = Math.min(maxRaiseAmount, base + step);
    setInputValue(String(nextVal));
  };

  return (
    <div className="raise-control" aria-label="Seletor de valor de aposta">
      <div className="raise-header">
        <span className="raise-title">{isBet ? 'Definir Aposta' : 'Definir Aumento (Raise)'}</span>
        <button
          type="button"
          className="text-button raise-cancel-x"
          onClick={onCancel}
          disabled={disabled}
          aria-label="Fechar seletor de aposta"
        >
          ✕
        </button>
      </div>

      {/* Feedback Financeiro Imediato */}
      <div className="raise-feedback">
        <div className="raise-target-display">
          <small>TOTAL DA APOSTA NA STREET</small>
          <strong className="tabular-nums">
            {parsedAmount !== null ? parsedAmount.toLocaleString('pt-BR') : '—'}
          </strong>
        </div>
        <div className="raise-extra-display">
          <span>
            {extraNeeded !== null ? `(+${extraNeeded.toLocaleString('pt-BR')} do seu stack)` : '—'}
          </span>
          {isAllIn && <span className="raise-allin-badge">ALL-IN</span>}
        </div>
      </div>

      {/* Slider Fluido de Aposta */}
      <div className="raise-slider-container">
        <div className="raise-slider-wrapper">
          <input
            type="range"
            min={minRaiseAmount}
            max={maxRaiseAmount}
            step={sliderStep}
            value={parsed !== null ? Math.min(maxRaiseAmount, Math.max(minRaiseAmount, parsed)) : minRaiseAmount}
            onChange={e => setInputValue(e.target.value)}
            disabled={disabled}
            className="raise-slider"
            style={{ '--slider-fill': `${fillPercent}%` } as React.CSSProperties}
            aria-label="Ajustar valor da aposta pelo controle deslizante"
          />
        </div>
        <div className="raise-slider-labels">
          <span>Mín: {minRaiseAmount.toLocaleString('pt-BR')}</span>
          <span>Máx: {maxRaiseAmount.toLocaleString('pt-BR')}</span>
        </div>
      </div>

      {/* Atalhos Rápidos: MÍN., ½ POTE, POTE, MÁX. */}
      <div className="raise-presets" role="group" aria-label="Atalhos rápidos de aposta">
        {presets.map(preset => {
          const isActive = parsedAmount === preset.amount;
          return (
            <button
              key={preset.id}
              type="button"
              className={`preset-btn ${isActive ? 'active' : ''} ${preset.isAllIn ? 'preset-allin' : ''}`}
              onClick={() => setInputValue(String(preset.amount))}
              disabled={disabled}
              aria-label={
                preset.id === 'max'
                  ? `MÁX. All-in (${preset.amount.toLocaleString('pt-BR')})`
                  : `${preset.label} (${preset.amount.toLocaleString('pt-BR')} fichas)`
              }
            >
              <span className="preset-name">{preset.label}</span>
              <span className="preset-val tabular-nums">
                {preset.amount.toLocaleString('pt-BR')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ajuste Fino e Digitação Direta */}
      <div className="raise-stepper">
        <button
          type="button"
          className="stepper-btn"
          onClick={handleDecrease}
          disabled={disabled || (parsed !== null && parsed <= minRaiseAmount)}
          aria-label={`Diminuir ${step} fichas`}
        >
          −
        </button>

        <input
          type="number"
          inputMode="numeric"
          step="any"
          min={minRaiseAmount}
          max={maxRaiseAmount}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          disabled={disabled}
          className="raise-input tabular-nums"
          aria-label={isBet ? 'Valor da aposta' : 'Valor total do aumento'}
          aria-invalid={!isValid}
          aria-errormessage={validationError ? 'raise-error-msg' : undefined}
        />

        <button
          type="button"
          className="stepper-btn"
          onClick={handleIncrease}
          disabled={disabled || (parsed !== null && parsed >= maxRaiseAmount)}
          aria-label={`Aumentar ${step} fichas`}
        >
          +
        </button>
      </div>

      {validationError && (
        <p id="raise-error-msg" className="raise-error" role="alert">
          {validationError}
        </p>
      )}

      {/* Ações Finais */}
      <div className="raise-actions">
        <button
          type="button"
          className="button secondary raise-btn-cancel"
          onClick={onCancel}
          disabled={disabled}
        >
          Voltar
        </button>
        <button
          type="button"
          className="button primary raise-btn-confirm"
          onClick={() => {
            if (isValid && parsedAmount !== null) {
              onConfirm(parsedAmount);
            }
          }}
          disabled={disabled || !isValid}
        >
          {parsedAmount !== null
            ? `Confirmar (${parsedAmount.toLocaleString('pt-BR')})`
            : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
