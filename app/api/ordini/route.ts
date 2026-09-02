import { autenticaRichiesta, rispostaErrore } from '@/lib/session';
import { caricaOrdini } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const sessione = autenticaRichiesta(req);
    const url = new URL(req.url);
    const forza = url.searchParams.get('forza') === '1';

    // Il perimetro è la data di inizio in configurazione, non un parametro della richiesta:
    // così tutti guardano lo stesso insieme di ordini.
    const { ordini, config, troncato, caricatoIl, dataInizio } =
      await caricaOrdini({ shop: sessione.shop, forza });
    return Response.json({ ordini, config, troncato, caricatoIl, dataInizio });
  } catch (e) { return rispostaErrore(e); }
}
