'use client';
import type { OrdineApp } from '@/lib/classify';
import { CAUSE_DATI, CAUSE_SPEDIZIONE, ORDINE_GRAVITA } from '@/lib/alerts';
import { Tracking, Badge, GruppoBadge, StatoBadge, TicketBadge, D, trascorso, Vuoto, BADGE_GRAVITA } from '../ui';
import { BarraRapidi, Rapido } from './Filtri';

/** Alert sui DATI dell'ordine: tag e date. Distinti, anche visivamente, dagli alert di spedizione. */
export function AlertDati(
  { ordini, rapido, setRapido, apri }:
  { ordini: OrdineApp[]; rapido: string | null; setRapido: (k: string | null) => void; apri: (id: string) => void }
) {
  const base = ordini.filter(o => o.alertDati.length);
  const rapidi: Rapido[] = [
    { k: '', label: 'Tutti' },
    { k: 'rimb', label: 'Rimborsati con merce in viaggio', test: o => o.alertDati.includes('rimborsato_in_viaggio') },
    { k: 'nodata', label: 'Senza data prevista', test: o => o.alertDati.some(c => c === 'data_mancante' || c === 'data_non_valida') },
    { k: 'tag', label: 'Tag alert presente', test: o => o.alertDati.includes('tag_alert') },
    { k: 'soc', label: 'Società incompleta', test: o => o.alertDati.includes('soc_incompleta') },
    { k: 'conf', label: 'Tag in conflitto', test: o => o.alertDati.includes('tag_conflitto') }
  ];
  const r = rapidi.find(x => x.k === rapido);
  const lista = (r?.test ? base.filter(r.test) : base)
    .sort((a, b) => ORDINE_GRAVITA[b.gravitaDati ?? 'informativo'] - ORDINE_GRAVITA[a.gravitaDati ?? 'informativo']);

  return (
    <>
      <div className="active-note">
        Sezione unica per il tag sorgente <b>alert</b> e per l’<b>alert applicativo</b> calcolato dall’app
        (data di spedizione prevista mancante o non valida, dati società incompleti, tag in conflitto).
        L’app <b>non scrive</b> alcun tag sulla piattaforma.
      </div>
      <BarraRapidi rapidi={rapidi} attivo={rapido} imposta={setRapido} base={base} />
      <div className="alist">
        {!lista.length && <Vuoto testo="Nessun ordine con dati da sistemare." />}
        {lista.map(o => {
          const prima = o.alertDati[0];
          return (
            <div key={o.id} className={`acard sev-${o.gravitaDati}`} onClick={() => apri(o.id)}>
              <div className="h"><span className="ordref">{o.nome}</span><GruppoBadge o={o} />
                <Badge tipo={BADGE_GRAVITA[o.gravitaDati!]}>{o.gravitaDati}</Badge>
                <span className="who">rilevato {trascorso(o.ricezione)}</span></div>
              <div className="reasons">
                {o.alertDati.map(c => <Badge key={c} tipo={BADGE_GRAVITA[CAUSE_DATI[c].gravita]}>{CAUSE_DATI[c].label}</Badge>)}
              </div>
              <div className="meta">
                <div><span>Data ordine</span>{D(o.ricezione)}</div>
                <div><span>Cliente</span>{o.cliente}</div>
                <div><span>Categoria / atleta</span>{o.isB2B ? '—' : `${o.categoria} · ${o.atleta}`}</div>
                <div><span>Data prevista</span>{o.prevista ? D(o.prevista) : <b style={{ color: 'var(--crit)' }}>assente</b>}</div>
                <div><span>Tracking</span><Tracking codice={o.tracking} url={o.trackingUrl} vuoto="nessuno" /></div>
                <div><span>Fase</span>{o.fase === 'da_spedire' ? 'Da spedire' : 'Da monitorare'}</div>
              </div>
              <div className="act"><b>Azione consigliata:</b> {CAUSE_DATI[prima].azione}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Alert operativi sul tracking. */
export function AlertSpedizione(
  { ordini, rapido, setRapido, apri }:
  { ordini: OrdineApp[]; rapido: string | null; setRapido: (k: string | null) => void; apri: (id: string) => void }
) {
  const base = ordini.filter(o => o.alertSpedizione.length);
  const rapidi: Rapido[] = [
    { k: '', label: 'Tutti' },
    { k: 'critico', label: 'Critici', test: o => o.gravitaSpedizione === 'critico' },
    { k: 'urgente', label: 'Urgenti', test: o => o.gravitaSpedizione === 'urgente' },
    { k: 'attenzione', label: 'Attenzione', test: o => o.gravitaSpedizione === 'attenzione' },
    { k: 'tda', label: 'Ticket da aprire', test: o => o.ticketDaAprire },
    { k: 'tap', label: 'Ticket già aperti', test: o => o.ticketAperto }
  ];
  const r = rapidi.find(x => x.k === rapido);
  const lista = (r?.test ? base.filter(r.test) : base).sort((a, b) =>
    ORDINE_GRAVITA[b.gravitaSpedizione!] - ORDINE_GRAVITA[a.gravitaSpedizione!] || b.ritardoGG - a.ritardoGG);

  return (
    <>
      <div className="active-note">
        Alert <b>operativi</b> sul tracking, distinti dagli alert sui dati. Le soglie sono configurabili e
        non dipendono dalla data prevista di spedizione.
      </div>
      <BarraRapidi rapidi={rapidi} attivo={rapido} imposta={setRapido} base={base} />
      <div className="alist">
        {!lista.length && <Vuoto testo="Nessun alert di spedizione." />}
        {lista.map(o => {
          const prima = o.alertSpedizione[0];
          return (
            <div key={o.id} className={`acard sev-${o.gravitaSpedizione}`} onClick={() => apri(o.id)}>
              <div className="h"><span className="ordref">{o.nome}</span><GruppoBadge o={o} />
                <Badge tipo={BADGE_GRAVITA[o.gravitaSpedizione!]}>{o.gravitaSpedizione}</Badge>
                <StatoBadge o={o} />
                <span className="who">{o.corriere} · {o.destinazione.citta} ({o.destinazione.provincia})</span></div>
              <div className="reasons">
                {o.alertSpedizione.map(a => <Badge key={a.causa} tipo={BADGE_GRAVITA[a.gravita]}>{CAUSE_SPEDIZIONE[a.causa].label}</Badge>)}
              </div>
              <div className="meta">
                <div><span>Cliente</span>{o.cliente}</div>
                <div><span>Tracking</span><Tracking codice={o.tracking} url={o.trackingUrl} /></div>
                <div><span>Ultimo evento</span>{o.ultimoEventoMessaggio ?? '—'}</div>
                <div><span>Luogo</span>{o.ultimoEventoLuogo ?? '—'}</div>
                <div><span>Fermo da</span>{trascorso(o.ultimoEventoAt)}</div>
                <div><span>Finestra prevista</span>{o.etaMax ? `${D(o.etaMin)} – ${D(o.etaMax)}${o.ritardoGG ? ` (+${o.ritardoGG} gg lav.)` : ''}` : '—'}</div>
                <div><span>Ticket</span>{o.ticket ? <TicketBadge stato={o.ticket.stato} /> : '—'}</div>
              </div>
              <div className="act"><b>Azione consigliata:</b> {CAUSE_SPEDIZIONE[prima.causa].azione}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
