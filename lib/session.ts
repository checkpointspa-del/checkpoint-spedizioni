/**
 * Autenticazione delle chiamate che arrivano dal frontend.
 *
 * L'app è embedded nell'Admin Shopify: App Bridge emette un "session token",
 * un JWT firmato HS256 con il client secret dell'app. Verificarlo prova che la
 * richiesta arriva da un utente già autenticato e autorizzato sullo store.
 * Non serve alcun sistema di login separato.
 *
 * Verifica eseguita: firma, algoritmo, emittente, destinatario (aud = client id),
 * shop di destinazione fra quelli consentiti, validità temporale.
 * Zero dipendenze: bastano node:crypto e un confronto a tempo costante.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export interface SessionToken {
  iss: string; dest: string; aud: string; sub: string;
  exp: number; nbf: number; iat: number; jti: string; sid?: string;
  /** dominio myshopify ricavato da `dest` */ shop: string;
}

const b64urlToBuf = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export class ErroreSessione extends Error {
  constructor(message: string) { super(message); this.name = 'ErroreSessione'; }
}

export function verificaSessionToken(token: string): SessionToken {
  const parti = token.split('.');
  if (parti.length !== 3) throw new ErroreSessione('Session token malformato');
  const [h, p, s] = parti;

  const header = JSON.parse(b64urlToBuf(h).toString('utf8')) as { alg?: string; typ?: string };
  if (header.alg !== 'HS256') throw new ErroreSessione('Algoritmo del token non ammesso');

  const atteso = createHmac('sha256', env.clientSecret).update(`${h}.${p}`).digest();
  const ricevuto = b64urlToBuf(s);
  if (atteso.length !== ricevuto.length || !timingSafeEqual(atteso, ricevuto))
    throw new ErroreSessione('Firma del session token non valida');

  const c = JSON.parse(b64urlToBuf(p).toString('utf8')) as Omit<SessionToken, 'shop'>;

  const ora = Math.floor(Date.now() / 1000);
  const tolleranza = 10; // secondi, per lo scarto di orologio
  if (typeof c.exp !== 'number' || c.exp + tolleranza < ora) throw new ErroreSessione('Session token scaduto');
  if (typeof c.nbf === 'number' && c.nbf - tolleranza > ora)  throw new ErroreSessione('Session token non ancora valido');
  if (c.aud !== env.clientId) throw new ErroreSessione('Session token emesso per un\'altra app');

  let shop: string;
  try { shop = new URL(c.dest).host; }
  catch { throw new ErroreSessione('Campo dest del token non valido'); }

  if (!env.allowedShops.includes(shop)) throw new ErroreSessione('Shop non autorizzato');
  if (c.iss && !c.iss.startsWith(`https://${shop}`)) throw new ErroreSessione('Emittente del token incoerente con lo shop');

  return { ...c, shop };
}

/** Estrae e verifica il token dall'header Authorization di una richiesta. */
export function autenticaRichiesta(req: Request): SessionToken {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new ErroreSessione('Header Authorization assente');
  return verificaSessionToken(m[1]);
}

/** Risposta JSON uniforme per gli errori, senza mai esporre dettagli interni. */
export function rispostaErrore(e: unknown): Response {
  if (e instanceof ErroreSessione) {
    return Response.json({ errore: e.message }, { status: 401 });
  }
  const msg = e instanceof Error ? e.message : 'Errore imprevisto';
  console.error('[checkpoint-spedizioni]', msg);
  return Response.json({ errore: msg }, { status: 500 });
}
