/**
 * Client Admin GraphQL.
 *
 * Autenticazione: Client Credentials Grant. L'app ottiene da sola l'access token
 * partendo da SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET; nessun token statico
 * viene chiesto all'utente né conservato in configurazione.
 *
 * Throttling: Shopify NON risponde 429. Risponde HTTP 200 con
 * errors[].extensions.code === 'THROTTLED'. Trattarlo come errore applicativo
 * fa perdere silenziosamente la lettura, quindi qui viene riconosciuto e ritentato.
 */
import { env } from './env';

interface TokenCache { token: string; scade: number }
const cache = new Map<string, TokenCache>();

async function accessToken(shop: string): Promise<string> {
  const ora = Date.now();
  const hit = cache.get(shop);
  if (hit && hit.scade > ora + 30_000) return hit.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.clientId,
    client_secret: env.clientSecret
  });
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  if (!res.ok) throw new Error(`Client Credentials Grant fallito: HTTP ${res.status}`);
  const j = await res.json() as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error('Client Credentials Grant: risposta senza access_token');

  const scade = ora + (j.expires_in ? j.expires_in * 1000 : 3_600_000);
  cache.set(shop, { token: j.access_token, scade });
  return j.access_token;
}

export interface GraphQLErrore { message: string; extensions?: { code?: string } }

const attesa = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function adminGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
  opts: { shop?: string; tentativi?: number } = {}
): Promise<T> {
  const shop = opts.shop || env.shop;
  const maxTentativi = opts.tentativi ?? 4;

  for (let tentativo = 1; tentativo <= maxTentativi; tentativo++) {
    const token = await accessToken(shop);
    const res = await fetch(`https://${shop}/admin/api/${env.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      },
      body: JSON.stringify({ query, variables })
    });

    if (res.status === 401 || res.status === 403) {
      cache.delete(shop);                    // token scaduto o revocato: rigenera
      if (tentativo < maxTentativi) { await attesa(300); continue; }
      throw new Error(`Admin API non autorizzata (HTTP ${res.status})`);
    }
    if (res.status >= 500) {
      if (tentativo < maxTentativi) { await attesa(400 * tentativo); continue; }
      throw new Error(`Admin API non disponibile (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(`Admin API: HTTP ${res.status}`);

    const j = await res.json() as { data?: T; errors?: GraphQLErrore[]; extensions?: any };
    const throttled = j.errors?.some(e => e.extensions?.code === 'THROTTLED');
    if (throttled) {
      if (tentativo < maxTentativi) {
        const stato = j.extensions?.cost?.throttleStatus;
        const mancanti = stato ? Math.max(0, (j.extensions.cost.requestedQueryCost || 100) - stato.currentlyAvailable) : 100;
        const pausa = stato?.restoreRate ? Math.min(5000, (mancanti / stato.restoreRate) * 1000 + 250) : 1200 * tentativo;
        await attesa(pausa);
        continue;
      }
      throw new Error('Admin API: limite di velocità superato, riprovare fra qualche istante');
    }
    if (j.errors?.length) throw new Error(`Admin API: ${j.errors.map(e => e.message).join(' · ')}`);
    if (!j.data) throw new Error('Admin API: risposta senza dati');
    return j.data;
  }
  throw new Error('Admin API: tentativi esauriti');
}
