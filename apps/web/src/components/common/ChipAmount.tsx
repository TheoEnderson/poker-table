export function ChipAmount({
  value,
  size = 'md',
  showSymbol = true,
  className = '',
}: {
  value: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSymbol?: boolean;
  className?: string;
}) {
  const formatted = Number.isSafeInteger(value) ? value.toLocaleString('pt-BR') : '0';
  return (
    <span className={`chip-amount chip-amount-${size} ${className}`}>
      {showSymbol && <span className="chip-symbol" aria-hidden="true">🪙</span>}
      <span className="chip-value tabular-nums">{formatted}</span>
    </span>
  );
}
