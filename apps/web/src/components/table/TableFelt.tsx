export function TableFelt() {
  return (
    <div className="table-felt-container" aria-hidden="true">
      <svg
        className="table-felt-svg"
        viewBox="0 0 1000 700"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gradiente do feltro verde profundo */}
          <radialGradient id="felt-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1a4d33" />
            <stop offset="65%" stopColor="#123b26" />
            <stop offset="100%" stopColor="#0b2417" />
          </radialGradient>

          {/* Gradiente da borda de madeira/couro escurecido */}
          <linearGradient id="rail-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#241a12" />
            <stop offset="50%" stopColor="#150f0b" />
            <stop offset="100%" stopColor="#2a1d15" />
          </linearGradient>

          {/* Sombra interna do feltro */}
          <filter id="felt-inner-shadow" x="-5%" y="-5%" width="110%" height="110%">
            <feOffset dx="0" dy="4" />
            <feGaussianBlur stdDeviation="8" result="offset-blur" />
            <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
            <feFlood floodColor="#000000" floodOpacity="0.6" result="color" />
            <feComposite operator="in" in="color" in2="inverse" result="shadow" />
            <feComposite operator="over" in="shadow" in2="SourceGraphic" />
          </filter>
        </defs>

        {/* Borda externa de madeira/couro (Outer Rail) */}
        <rect
          x="8"
          y="8"
          width="984"
          height="684"
          rx="342"
          ry="342"
          fill="url(#rail-gradient)"
          stroke="#422e1d"
          strokeWidth="3"
        />

        {/* Linha de costura sutil do apoio de braço */}
        <rect
          x="22"
          y="22"
          width="956"
          height="656"
          rx="328"
          ry="328"
          fill="none"
          stroke="#3d2b1f"
          strokeWidth="1.5"
          strokeDasharray="6 4"
        />

        {/* Superfície do feltro (Felt Tabletop) */}
        <rect
          x="34"
          y="34"
          width="932"
          height="632"
          rx="316"
          ry="316"
          fill="url(#felt-gradient)"
          stroke="#091b12"
          strokeWidth="4"
          filter="url(#felt-inner-shadow)"
        />

        {/* Linha dourada clássica de apostas (Betting Line) */}
        <rect
          x="120"
          y="110"
          width="760"
          height="480"
          rx="240"
          ry="240"
          fill="none"
          stroke="#d4af37"
          strokeWidth="1.5"
          strokeOpacity="0.25"
          strokeDasharray="10 6"
        />

        {/* Marca d'água elegante no centro do feltro */}
        <g opacity="0.12">
          <circle cx="500" cy="350" r="160" fill="none" stroke="#d4af37" strokeWidth="1" />
          <path
            d="M 500,310 C 490,290 470,290 470,310 C 470,330 500,360 500,360 C 500,360 530,330 530,310 C 530,290 510,290 500,310 Z"
            fill="#d4af37"
          />
          <text
            x="500"
            y="390"
            fill="#d4af37"
            fontSize="18"
            fontWeight="700"
            letterSpacing="6"
            textAnchor="middle"
          >
            POKER TABLE
          </text>
        </g>
      </svg>
    </div>
  );
}
