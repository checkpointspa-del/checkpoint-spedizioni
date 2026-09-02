/**
 * Diagnostica. Espone soltanto i NOMI delle variabili d'ambiente e se sono
 * valorizzate: mai un valore, mai un token, coerentemente con la regola
 * "nessun segreto in codice, log o documentazione".
 */
import { envStatus } from '@/lib/env';
import { adminGraphQL } from '@/lib/shopify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Q = `query { shop { name ianaTimezone } appInstallation { accessScopes { handle } } }`;

export async function GET() {
  const base = { variabili: envStatus(), ora: new Date().toISOString() };
  try {
    const d = await adminGraphQL<any>(Q);
    const scopes: string[] = d.appInstallation?.accessScopes?.map((s: any) => s.handle) ?? [];
    return Response.json({
      ...base,
      shopify: 'raggiungibile',
      shop: d.shop?.name ?? null,
      fusoShop: d.shop?.ianaTimezone ?? null,
      scopes,
      /* read_all_orders e' uno scope PROTETTO: si richiede a Shopify e va approvato.
         Finche' non e' concesso l'Admin API restituisce solo gli ultimi 60 giorni,
         in silenzio. Questo campo esiste per rendere quel silenzio visibile. */
      storicoCompleto: scopes.includes('read_all_orders'),
      avviso: scopes.includes('read_all_orders')
        ? null
        : 'read_all_orders non concesso: Shopify restituisce solo gli ultimi 60 giorni '
          + 'e non lo segnala. Gli ordini mai chiusi piu\u2019 vecchi di 60 giorni sono '
          + 'invisibili all\u2019app, presidio compreso.',
      perimetro: 'solo ordini non consegnati'
    });
  } catch (e) {
    return Response.json({ ...base, shopify: 'non raggiungibile',
      dettaglio: e instanceof Error ? e.message : 'errore' }, { status: 503 });
  }
}
