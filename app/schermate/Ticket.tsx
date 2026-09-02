'use client';
import type { OrdineApp } from '@/lib/classify';
import { CAUSE_SPEDIZIONE, STATI_TICKET } from '@/lib/alerts';
import { Tracking, Badge, TicketBadge, D, trascorso, Vuoto, b2cInFondo } from '../ui';
import { BarraRapidi, Rapido } from './Filtri';

export default function Ticket(
  { ordini, rapido, setRapido, apri }:
  { ordini: OrdineApp[]; rapido: string | null; setRapido: (k: string | null) => void; apri: (id: string) => void }
) {
  /* REGISTRO DI LAVORO, non lista di rilevamento — e' questa la differenza con
     «Alert spedizione», che elenca cio' che NON VA. Qui entra solo cio' che qualcuno
     deve fare o sta facendo col vettore:
      - serve un tracking: senza codice non c'e' niente da contestare al corriere;
      - resta fuori lo stato `da_verificare`, che e' il segnaposto creato dall'app e non
        una pratica aperta da nessuno. Quelle anomalie si vedono in «Alert spedizione».
     La merce ancora in magazzino non arriva nemmeno fin qui: non genera piu' alert di
     spedizione, quindi nessun ticket. */
  const base = ordini.filter(o => o.ticket && o.tracking && o.ticket.stato !== 'da_verificare');
  const rapidi: Rapido[] = [
    { k: '', label: 'Tutti' },
    { k: 'attivi', label: 'Attivi', test: o => o.ticketDaAprire || o.ticketAperto },
    ...Object.entries(STATI_TICKET)
      .filter(([k]) => k !== 'da_verificare')
      .map(([k, l]) => ({ k, label: l, test: (o: OrdineApp) => o.ticket?.stato === k }))
  ];
  const attivo = rapido ?? 'attivi';
  const r = rapidi.find(x => x.k === attivo);
  const lista = (r?.test ? base.filter(r.test) : base)
    .sort(b2cInFondo<OrdineApp>((a, b) => a.nome.localeCompare(b.nome)));

  return (
    <>
      <div className="active-note">
        <b>Che cosa stiamo facendo con i corrieri.</b> Ci entra solo una spedizione che il vettore ha davvero
        preso in carico e per cui c’è una pratica da aprire o già aperta. Le anomalie ancora da valutare stanno
        in <b>Alert spedizione</b>; la merce ferma nel nostro magazzino sta in <b>Da spedire</b>.
        L’app <b>non invia nulla</b> al vettore: registra che cosa ha fatto l’operatore e quando ricontrollare.
      </div>
      <BarraRapidi rapidi={rapidi} attivo={attivo} imposta={k => setRapido(k)} base={base} />
      {!lista.length ? <Vuoto testo="Nessun ticket con questo filtro." /> : (
        <div className="card"><div className="tw"><table>
          <thead><tr><th>Ordine</th><th>Società / B2C</th><th>Corriere</th><th>Motivo</th><th>Stato ticket</th>
            <th>Riferimento</th><th>Operatore</th><th>Aperto</th><th>Ultimo agg.</th><th>Prossimo controllo</th></tr></thead>
          <tbody>
            {lista.map(o => {
              const t = o.ticket!;
              const scaduto = t.prossimoControllo && new Date(t.prossimoControllo) < new Date();
              return (
                <tr key={o.id} className={o.isB2C ? 'b2c-row' : ''} onClick={() => apri(o.id)}>
                  <td><span className="ordref">{o.nome}</span></td>
                  <td>{o.isB2C ? <Badge tipo="b2c">B2C</Badge> : o.socNome}</td>
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
