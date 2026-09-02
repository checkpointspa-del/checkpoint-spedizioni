import { autenticaRichiesta, rispostaErrore } from '@/lib/session';
import { caricaOrdine } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const sessione = autenticaRichiesta(req);
    const { id } = await ctx.params;
    const gid = id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`;
    const ordine = await caricaOrdine(gid, sessione.shop);
    if (!ordine) return Response.json({ errore: 'Ordine non trovato' }, { status: 404 });
    return Response.json({ ordine });
  } catch (e) { return rispostaErrore(e); }
}
