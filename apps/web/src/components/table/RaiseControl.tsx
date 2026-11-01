import { useEffect, useState } from 'react';

export function RaiseControl({
  minRaiseAmount,
  maxRaiseAmount,
  minRaiseIncrement,
  playerRoundCommitted,
  playerChips,
  disabled,
  onConfirm,
  onCancel,
}: {
  minRaiseAmount: number;
  maxRaiseAmount: number;
  minRaiseIncrement: number;
  playerRoundCommitted: number;
  playerChips: number;
  disabled: boolean;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
}) {
  const [inputValue, setInputValue] = useState<string>(String(minRaiseAmount));

  // Sincroniza se os limites mudarem devido a atualizações na mesa
  useEffect(() => {
    setInputValue(String(minRaiseAmount));
  }, [minRaiseAmount, maxRaiseAmount]);

  const step = minRaiseIncrement > 0 ? minRaiseIncrement : 1;

  const trimmed = inputValue.trim();
  const isStrictInt = /^\d+$/.test(trimmed);
  const parsed = isStrictInt ? Number(trimmed) : null;
  const isSafeInt = parsed !== null && Number.isSafeInteger(parsed);

  let validationError: string | null = null;
  if (trimmed === '') {
    validationError = 'Informe um valor para o aumento.';
  } else if (!isStrictInt || !isSafeInt) {
    validationError = 'O valor deve ser um número inteiro, sem casas decimais.';
  } else if (parsed < minRaiseAmount) {
    validationError = `O valor mínimo é ${minRaiseAmount.toLocaleString('pt-BR')}.`;
  } else if (parsed > maxRaiseAmount) {
    validationError = `O valor máximo disponível é ${maxRaiseAmount.toLocaleString('pt-BR')}.`;
  } else if (parsed - playerRoundCommitted > playerChips) {
    validationError = 'Fichas insuficientes.';
  }

  const isValid = validationError === null && parsed !== null;
  const parsedAmount = isValid ? parsed : null;
  const isAllIn = parsedAmount === maxRaiseAmount;
  const extraNeeded =
    parsedAmount !== null ? Math.max(0, parsedAmount - playerRoundCommitted) : null;

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
        <span className="raise-title">Definir Aumento (Raise)</span>
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
          aria-label="Valor total do raise"
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

      <div className="raise-presets">
        <button
          type="button"
          className={`preset-btn ${parsedAmount === minRaiseAmount ? 'active' : ''}`}
          onClick={() => setInputValue(String(minRaiseAmount))}
          disabled={disabled}
        >
          Mínimo ({minRaiseAmount.toLocaleString('pt-BR')})
        </button>

        {maxRaiseAmount > minRaiseAmount && (
          <button
            type="button"
            className={`preset-btn ${parsedAmount === maxRaiseAmount ? 'active' : ''}`}
            onClick={() => setInputValue(String(maxRaiseAmount))}
            disabled={disabled}
          >
            All-in ({maxRaiseAmount.toLocaleString('pt-BR')})
          </button>
        )}
      </div>

      {validationError && (
        <p id="raise-error-msg" className="raise-error" role="alert">
          {validationError}
        </p>
      )}

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

