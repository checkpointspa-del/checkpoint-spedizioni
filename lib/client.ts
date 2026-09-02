'use client';
/**
 * Chiamate al backend dell'app.
 * App Bridge fornisce un session token nuovo a ogni chiamata (dura un minuto):
 * si richiede sempre al momento, non si conserva.
 */
declare global { interface Window { shopify?: { idToken(): Promise<string> } } }

export class ErroreApi extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * App Bridge e' caricato con strategia `beforeInteractive`, quindi normalmente
 * e' gia' pronto. Questa attesa breve copre il caso in cui la CDN Shopify
 * risponda lenta: meglio mezzo secondo di attesa che un errore in faccia
 * all'operatore e un pulsante "Riprova" da premere a mano.
 */
async function attendiAppBridge(msMax = 3000): Promise<void> {
  const scadenza = Date.now() + msMax;
  while (!window.shopify?.idToken) {
    if (Date.now() > scadenza) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

async function token(): Promise<string> {
  if (typeof window === 'undefined')
    throw new ErroreApi('App Bridge non disponibile: aprire l’app dall’Admin Shopify.', 401);
  if (!window.shopify?.idToken) await attendiAppBridge();
  if (!window.shopify?.idToken)
    throw new ErroreApi('App Bridge non disponibile: aprire l’app dall’Admin Shopify.', 401);
  return window.shopify.idToken();
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token()}`
    }
  });
  const testo = await res.text();
  let corpo: any = null;
  try { corpo = testo ? JSON.parse(testo) : null; } catch { /* risposta non JSON */ }
  if (!res.ok) throw new ErroreApi(corpo?.errore || `Errore ${res.status}`, res.status);
  return corpo as T;
}
