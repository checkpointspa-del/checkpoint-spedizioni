'use client';
import type { OrdineApp } from '@/lib/classify';
import { CAUSE_SPEDIZIONE, STATI_TICKET } from '@/lib/alerts';
import { Tracking, Badge, TicketBadge, D, trascorso, Vuoto, b2bInFondo } from '../ui';
import { BarraRapidi, Rapido } from './Filtri';

export default function Ticket(
  { ordini, rapido, setRapido, apri }:
  { ordini: OrdineApp[]; rapido: string | null; setRapido: (k: string | null) => void; apri: (id: string) => void }
) {
  /* Registro dei ticket VERSO IL CORRIERE: ci entrano solo le spedizioni che il corriere
     ha davvero, cioe' quelle con un codice. Un ordine senza tracking non ha nulla da
     contestare al vettore e qui sarebbe solo rumore — si lavora da "Da spedire". */
  const base = ordini.filter(o => o.ticket && o.tracking);
  const rapidi: Rapido[] = [
    { k: '', label: 'Tutti' },
    { k: 'attivi', label: 'Attivi', test: o => o.ticketDaAprire || o.ticketAperto },
    ...Object.entries(STATI_TICKET).map(([k, l]) => ({ k, label: l, test: (o: OrdineApp) => o.ticket?.stato === k }))
  ];
  const attivo = rapido ?? 'attivi';
  const r = rapidi.find(x => x.k === attivo);
  const lista = (r?.test ? base.filter(r.test) : base)
    .sort(b2bInFondo<OrdineApp>((a, b) => a.nome.localeCompare(b.nome)));

  return (
    <>
      <div className="active-note">
        Registro dei ticket con i corrieri. L’app <b>non invia nulla</b> al vettore: registra che cosa ha fatto
        l’operatore e quando ricontrollare. Lo stato è salvato in un metafield dell’ordine, dentro Shopify.
      </div>
      <BarraRapidi rapidi={rapidi} attivo={attivo} imposta={k => setRapido(k)} base={base} />
      {!lista.length ? <Vuoto testo="Nessun ticket con questo filtro." /> : (
        <div className="card"><div className="tw"><table>
          <thead><tr><th>Ordine</th><th>Società / B2B</th><th>Corriere</th><th>Motivo</th><th>Stato ticket</th>
            <th>Riferimento</th><th>Operatore</th><th>Aperto</th><th>Ultimo agg.</th><th>Prossimo controllo</th></tr></thead>
          <tbody>
            {lista.map(o => {
              const t = o.ticket!;
              const scaduto = t.prossimoControllo && new Date(t.prossimoControllo) < new Date();
              return (
                <tr key={o.id} className={o.isB2B ? 'b2b-row' : ''} onClick={() => apri(o.id)}>
                  <td><span className="ordref">{o.nome}</span></td>
                  <td>{o.isB2B ? <Badge tipo="b2b">B2B</Badge> : o.socNome}</td>
                  <td>{t.corriere ?? o.corriere ?? '—'}</td>
                  <td>{o.alertSpedizione.length ? CAUSE_SPEDIZIONE[o.alertSpedizione[0].causa].label : <span className="muted">—</span>}</td>
                  <td><TicketBadge stato={t.stato} /></td>
                  <td><Tracking codice={t.riferimento} url={t.riferimento === o.tracking ? o.trackingUrl : null} /></td>
                  <td>{t.operatore ?? <span className="muted">—</span>}</td>
                  <td className="num">{t.apertoIl ? D(t.apertoIl) : '—'}</td>
                  <td className="num">{t.aggiornatoIl ? trascorso(t.aggiornatoIl) : '—'}</td>
                  <td className="num">{t.prossimoControllo
                    ? <Badge tipo={scaduto ? 'urg' : 'info'}>{scaduto ? 'scaduto ' : ''}{D(t.prossimoControllo)}</Badge>
                    : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div></div>
      )}
    </>
  );
}
