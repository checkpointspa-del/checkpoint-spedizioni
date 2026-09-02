'use client';
import type { OrdineApp } from '@/lib/classify';
import type { Config } from '@/lib/config';
import { STATI } from '@/lib/status';
import { Tracking, Badge, Progresso, Finestra, TicketBadge, DT, trascorso, Vuoto, b2cInFondo, BADGE_GRAVITA } from '../ui';
import { BarraFiltri, BarraRapidi, DefFiltro, Rapido, applica } from './Filtri';

export default function DaMonitorare(
  { ordini, config, filtri, imposta, azzera, rapido, setRapido, apri, opzioni }:
  { ordini: OrdineApp[]; config: Config;
    filtri: Record<string, string>; imposta: (k: string, v: string) => void; azzera: () => void;
    rapido: string | null; setRapido: (k: string | null) => void;
    apri: (id: string) => void; opzioni: Record<string, () => [string, string][]> }
) {
  // Regola terminale: qui vivono solo le spedizioni ancora in viaggio.
  // Un ordine consegnato non viene nemmeno caricato da Shopify.
  const base = ordini.filter(o => o.fase === 'da_monitorare');
  const fermo = config.soglie.oreTrackingFermo;

  const defs: DefFiltro[] = [
    { k: 'stato', label: 'Stato normalizzato', opzioni: () => Object.entries(STATI).map(([k, v]) => [k, v.label]),
      test: (o, v) => o.stato === v },
    { k: 'corriere', label: 'Corriere', opzioni: opzioni.corriere, test: (o, v) => o.corriere === v },
    { k: 'gruppo', label: 'Società / B2C', opzioni: opzioni.gruppo, test: (o, v) => (v === 'B2C' ? o.isB2C : o.socNome === v) },
    { k: 'paese', label: 'Paese', opzioni: opzioni.paese, test: (o, v) => o.destinazione.paese === v },
    { k: 'regione', label: 'Regione', opzioni: opzioni.regione, test: (o, v) => o.destinazione.regione === v },
    { k: 'prov', label: 'Provincia', opzioni: opzioni.provincia, test: (o, v) => o.destinazione.provincia === v },
    { k: 'zona', label: 'Zona / finestra',
      opzioni: () => Object.entries(config.finestre).map(([k, f]) => [k, f.label]), test: (o, v) => o.zona === v },
    { k: 'tempi', label: 'Rispetto finestra',
      opzioni: () => [['ok', 'Nei tempi'], ['scad', 'Prossime alla scadenza'], ['oltre', 'Oltre la finestra']],
      test: (o, v) => v === 'ok' ? (!o.ritardoGG && !o.inScadenza && o.etaMax) : v === 'scad' ? o.inScadenza : o.ritardoGG > 0 },
    { k: 'agg', label: 'Ultimo tracking', opzioni: () => [['fermo', 'Non aggiornato'], ['fresco', 'Aggiornato']],
      test: (o, v) => v === 'fermo' ? (o.oreUltimoEvento ?? 0) > fermo : (o.oreUltimoEvento ?? 0) <= fermo },
    { k: 'anom', label: 'Anomalie', opzioni: () => [['si', 'Con anomalie'], ['no', 'Senza anomalie']],
      test: (o, v) => v === 'si' ? o.alertSpedizione.length : !o.alertSpedizione.length },
    { k: 'ticket', label: 'Ticket',
      opzioni: () => [['da_aprire', 'Da aprire'], ['aperto', 'Già aperto'], ['nessuno', 'Nessuno']],
      test: (o, v) => v === 'da_aprire' ? o.ticketDaAprire : v === 'aperto' ? o.ticketAperto : !o.ticket },
    { k: 'ordine', label: 'Numero ordine', tipo: 'testo', test: (o, v) => o.nome.toLowerCase().includes(v.toLowerCase()) },
    { k: 'trk', label: 'Codice tracking', tipo: 'testo', test: (o, v) => (o.tracking ?? '').toLowerCase().includes(v.toLowerCase()) }
  ];
  const rapidi: Rapido[] = [
    { k: '', label: 'Tutte' },
    { k: 'rimb', label: 'Rimborsati con merce in viaggio', test: o => o.rimborsatoTotale },
    { k: 'transito', label: 'In transito', test: o => ['in_transito', 'preso_in_carico'].includes(o.stato) },
    { k: 'consegna', label: 'In consegna', test: o => o.stato === 'in_consegna' },
    { k: 'ferme', label: 'Ferme', test: o => ['ferma', 'giacenza'].includes(o.statoReale ?? o.stato) },
    { k: 'ritardo', label: 'In ritardo', test: o => o.ritardoGG > 0 },
    { k: 'ecc', label: 'In eccezione',
      test: o => ['eccezione', 'indirizzo_errato', 'rifiutata', 'rientro_mittente', 'destinatario_assente'].includes(o.statoReale ?? o.stato) },
    { k: 'stale', label: 'Senza aggiornamenti', test: o => (o.oreUltimoEvento ?? 0) > fermo },
    { k: 'tda', label: 'Ticket da aprire', test: o => o.ticketDaAprire },
    { k: 'tap', label: 'Ticket già aperti', test: o => o.ticketAperto }
  ];

  const pre = applica(base, defs, filtri);
  const r = rapidi.find(x => x.k === rapido);
  const lista = (r?.test ? pre.filter(r.test) : pre)
    .sort(b2cInFondo<OrdineApp>((a, b) => (b.ritardoGG - a.ritardoGG) || a.nome.localeCompare(b.nome)));

  return (
    <>
      <div className="active-note">
        Vista sintetica dell’avanzamento. La cronologia completa si apre nel dettaglio della spedizione.
        Finestra di consegna calcolata in giorni lavorativi dalla <b>presa in carico effettiva</b>, fuso Europe/Rome.
      </div>
      <BarraRapidi rapidi={rapidi} attivo={rapido} imposta={setRapido} base={pre} />
      <BarraFiltri defs={defs} valori={filtri} imposta={imposta} azzera={azzera} />
      {!lista.length ? <Vuoto testo="Nessuna spedizione con i filtri attivi." /> : (
        <div className="card"><div className="tw"><table>
          <thead><tr><th>Ordine</th><th>Destinatario</th><th>Società / B2C</th><th>Corriere</th>
            <th>Tracking</th><th>Partenza</th><th>Ultimo agg.</th><th>Avanzamento</th>
            <th>Consegna stimata</th><th>Alert</th><th>Ticket</th></tr></thead>
          <tbody>
            {lista.map(o => (
              <tr key={o.id} className={o.isB2C ? 'b2c-row' : ''} onClick={() => apri(o.id)}>
                <td><div className="stack"><span className="ordref">{o.nome}</span>
                  {o.rimborsatoTotale && <Badge tipo="crit">rimborsato</Badge>}</div></td>
                <td><div className="stack">{o.cliente}
                  <span className="s2">{o.destinazione.citta} ({o.destinazione.provincia}) · {o.destinazione.paese}</span></div></td>
                <td>{o.isB2C ? <Badge tipo="b2c">B2C</Badge> :
                  <div className="stack">{o.socNome}<span className="s2">{o.categoria}</span></div>}</td>
                <td>{o.corriere ?? <span className="muted">—</span>}</td>
                <td><Tracking codice={o.tracking} url={o.trackingUrl} /></td>
                <td className="num">{DT(o.presaAt)}</td>
                <td className="num"><div className="stack">{trascorso(o.ultimoEventoAt)}
                  <span className="s2">{o.ultimoEventoLuogo ?? ''}</span></div></td>
                <td><Progresso o={o} /></td>
                <td className="num"><Finestra o={o} /></td>
                <td>{o.alertSpedizione.length
                  ? <Badge tipo={BADGE_GRAVITA[o.gravitaSpedizione!]}>{o.alertSpedizione.length} · {o.gravitaSpedizione}</Badge>
                  : <span className="muted">—</span>}</td>
                <td>{o.ticket ? <TicketBadge stato={o.ticket.stato} /> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}
    </>
  );
}
