import type { ReactNode } from 'react';
export function Layout({ children }: { children: ReactNode }) {
  return <><a className="skip-link" href="#main">Pular para o conteúdo</a><header className="header"><a href="/" className="brand" aria-label="Poker Table, início"><span className="brand-mark" aria-hidden="true">♠</span><span>Poker <strong>Table</strong></span></a><span className="local-tag"><i /> Rede local</span></header><main id="main" tabIndex={-1}>{children}</main><footer>Cartas na mesa. Amigos por perto.<span>Poker Table · Etapa 1</span></footer></>;
}
export function ErrorNotice({ message }: { message: string }) { return message ? <p className="notice error" role="alert">{message}</p> : null; }
