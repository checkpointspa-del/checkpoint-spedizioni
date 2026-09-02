/**
 * Stato del ticket corriere.
 *
 * Vive in un metafield dell'ordine (`checkpoint.spedizione_ticket`): è l'unico
 * stato che Shopify non ha già e che l'app deve conservare. Nessun database.
 * L'app NON invia nulla al corriere: registra soltanto cosa ha fatto l'operatore.
 */
import { autenticaRichiesta, rispostaErrore } from '@/lib/session';
import { scriviMetafield, caricaOrdine } from '@/lib/store';
import { METAFIELD_TICKET } from '@/lib/config';
import { STATI_TICKET, StatoTicket, Ticket } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const sessione = autenticaRichiesta(req);
    const body = await req.json() as Partial<Ticket> & { ordineId?: string };

    if (!body.ordineId) return Response.json({ errore: 'ordineId mancante' }, { status: 400 });
    if (!body.stato || !(body.stato in STATI_TICKET))
      return Response.json({ errore: 'Stato ticket non valido' }, { status: 400 });

    const precedente = await caricaOrdine(body.ordineId, sessione.shop);
    if (!precedente) return Response.json({ errore: 'Ordine non trovato' }, { status: 404 });

    const ora = new Date().toISOString();
    const stato = body.stato as StatoTicket;
    const ticket: Ticket = {
      stato,
      apertoIl: precedente.ticket?.apertoIl
        ?? (['ticket_aperto', 'attesa_corriere'].includes(stato) ? ora : null),
      operatore: body.operatore ?? precedente.ticket?.operatore ?? null,
      corriere: body.corriere ?? precedente.corriere ?? null,
      riferimento: body.riferimento ?? precedente.ticket?.riferimento ?? null,
      note: body.note ?? precedente.ticket?.note ?? null,
      aggiornatoIl: ora,
      prossimoControllo: body.prossimoControllo ?? precedente.ticket?.prossimoControllo ?? null,
      esito: body.esito ?? precedente.ticket?.esito ?? null
    };

    await scriviMetafield(body.ordineId, METAFIELD_TICKET.namespace, METAFIELD_TICKET.key, ticket, sessione.shop);
    return Response.json({ ticket });
  } catch (e) { return rispostaErrore(e); }
}
