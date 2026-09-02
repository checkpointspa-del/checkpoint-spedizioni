import { autenticaRichiesta, rispostaErrore } from '@/lib/session';
import { caricaConfig, scriviMetafield, invalidaCache } from '@/lib/store';
import { mergeConfig, METAFIELD_CONFIG } from '@/lib/config';
import { adminGraphQL } from '@/lib/shopify';
import { Q_CONFIG } from '@/lib/graphql';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const s = autenticaRichiesta(req);
    return Response.json({ config: await caricaConfig(s.shop) });
  } catch (e) { return rispostaErrore(e); }
}

export async function PUT(req: Request) {
  try {
    const s = autenticaRichiesta(req);
    const body = await req.json();
    const config = mergeConfig(body);   // i default riempiono sempre i buchi
    // Il proprietario è l'installazione dell'app: nessuno scope in più, nessuna
    // definizione da creare a mano, e la configurazione non sporca l'Admin.
    const d = await adminGraphQL<{ currentAppInstallation: { id: string } }>(Q_CONFIG, {}, { shop: s.shop });
    await scriviMetafield(d.currentAppInstallation.id, METAFIELD_CONFIG.namespace,
                          METAFIELD_CONFIG.key, config, s.shop);
    invalidaCache();
    return Response.json({ config });
  } catch (e) { return rispostaErrore(e); }
}
