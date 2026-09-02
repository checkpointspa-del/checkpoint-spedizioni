'use client';
import { useState } from 'react';
import type { OrdineApp } from '@/lib/classify';
import { Badge, D, Vuoto, b2bInFondo } from '../ui';
import { BarraFiltri, BarraRapidi, DefFiltro, Rapido, applica } from './Filtri';

const FASI: Record<string, string> = {
  senza_tracking: 'Senza tracking', tracking_creato: 'Tracking creato',
  in_attesa_ritiro: 'In attesa di ritiro', preso_in_carico: 'Preso in carico'
};

/** Ordinamento unico della schermata: prima la data prevista, poi il numero d'ordine. */
const perDataPrevista = b2bInFondo<OrdineApp>((a, b) =>
  (a.prevista ?? '9999').localeCompare(b.prevista ?? '9999') || a.nome.localeCompare(b.nome));

function Tabella({ lista, oggi, apri }:
  { lista: OrdineApp[]; oggi: string; apri: (id: string) => void }) {
  return (
    <div className="card"><div className="tw"><table>
      <thead><tr><th>Ordine</th><th>Data</th><th>Cliente</th><th>Società / B2B</th>
        <th>Prevista</th><th>Fase di ritiro</th><th>Tracking</th><th>Alert</th></tr></thead>
      <tbody>
        {lista.map(o => (
          <tr key={o.id} className={o.isB2B ? 'b2b-row' : ''} onClick={() => apri(o.id)}>
            <td><span className="ordref">{o.nome}</span></td>
            <td className="num">{D(o.ricezione)}</td>
            <td><div className="stack">{o.cliente}
              <span className="s2">{o.destinazione.citta} ({o.destinazione.provincia})</span></div></td>
            <td>{o.isB2B ? <Badge tipo="b2b">B2B</Badge> :
              <div className="stack">{o.socNome}<span className="s2">{o.categoria} · {o.atleta}</span></div>}</td>
            <td className="num">{!o.prevista ? <Badge tipo="crit">assente</Badge>
              : o.prevista < oggi ? <Badge tipo="crit">{D(o.prevista)}</Badge>
              : o.prevista === oggi ? <Badge tipo="warn">oggi</Badge> : D(o.prevista)}</td>
            <td><Badge tipo={o.faseRitiro === 'in_attesa_ritiro' ? 'warn' : 'neutral'}>{FASI[o.faseRitiro]}</Badge></td>
            <td>{o.tracking ? <span className="tr-code">{o.tracking}</span> : <span className="muted">—</span>}</td>
            <td>{o.alertDati.length ? <Badge tipo="warn">{o.alertDati.length} dati</Badge> : null}
                {o.alertSpedizione.length ? <> <Badge tipo="urg">{o.alertSpedizione.length} sped.</Badge></> : null}
                {!o.alertDati.length && !o.alertSpedizione.length && <span className="muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

export default function DaSpedire(
  { ordini, oggi, filtri, imposta, azzera, rapido, setRapido, apri, opzioni }:
  { ordini: OrdineApp[]; oggi: string;
    filtri: Record<string, string>; imposta: (k: string, v: string) => void; azzera: () => void;
    rapido: string | null; setRapido: (k: string | null) => void;
    apri: (id: string) => void; opzioni: Record<string, () => [string, string][]> }
) {
  /* Il blocco degli scaduti nasce chiuso: dentro "Previsti oggi" gli ordini in ritardo
     sono piu' numerosi di quelli da spedire davvero e coprivano il lavoro della giornata. */
  const [ritardoAperto, setRitardoAperto] = useState(false);

  const base = ordini.filter(o => o.fase === 'da_spedire');

  const defs: DefFiltro[] = [
    { k: 'fase', label: 'Fase di ritiro', opzioni: () => Object.entries(FASI), test: (o, v) => o.faseRitiro === v },
    { k: 'gruppo', label: 'Società / B2B', opzioni: opzioni.gruppo, test: (o, v) => (v === 'B2B' ? o.isB2B : o.socNome === v) },
    { k: 'corriere', label: 'Corriere', opzioni: opzioni.corriere, test: (o, v) => o.corriere === v },
    { k: 'prevista', label: 'Data prevista',
      opzioni: () => [['oggi', 'Oggi'], ['scaduta', 'Scaduta'], ['futura', 'Prossimi giorni'], ['assente', 'Assente o non valida']],
      test: (o, v) => v === 'oggi' ? o.prevista === oggi
        : v === 'scaduta' ? (o.prevista && o.prevista < oggi)
        : v === 'futura' ? (o.prevista && o.prevista > oggi) : !o.prevista },
    /* Data singola = stessa data nei due campi; intervallo = da–a; uno solo dei due =
       estremo aperto. Gli ordini senza data prevista escono quando un estremo e' attivo:
       una data che non c'e' non puo' cadere dentro un intervallo. */
    { k: 'previstaDal', label: 'Prevista dal', tipo: 'data', test: (o, v) => o.prevista && o.prevista >= v },
    { k: 'previstaAl', label: 'Prevista al', tipo: 'data', test: (o, v) => o.prevista && o.prevista <= v },
    { k: 'alert', label: 'Alert dati', opzioni: () => [['si', 'Con alert'], ['no', 'Senza alert']],
      test: (o, v) => v === 'si' ? o.alertDati.length : !o.alertDati.length }
  ];
  const rapidi: Rapido[] = [
    { k: '', label: 'Tutti' },
    { k: 'oggi', label: 'Previsti oggi', test: o => o.prevista === oggi },
    { k: 'scaduti', label: 'Data superata', test: o => o.prevista && o.prevista < oggi },
    { k: 'notrack', label: 'Senza tracking', test: o => !o.tracking },
    { k: 'attesa', label: 'Tracking creato — in attesa di ritiro', test: o => Boolean(o.tracking) },
    { k: 'alert', label: 'Con alert dati', test: o => o.alertDati.length }
  ];

  const pre = applica(base, defs, filtri);
  const r = rapidi.find(x => x.k === rapido);
  const lista = (r?.test ? pre.filter(r.test) : pre).sort(perDataPrevista);

  /* In ritardo: solo dentro "Previsti oggi", dove il confronto serve a decidere.
     Negli altri filtri rapidi sarebbe una seconda lista fuori contesto. */
  const inRitardo = rapido === 'oggi'
    ? pre.filter(o => o.prevista && o.prevista < oggi).sort(perDataPrevista)
    : [];

  return (
    <>
      <div className="active-note">
        Un ordine resta qui finché il tracking non mostra un <b>evento affidabile di uscita dal magazzino</b>.
        La sola creazione della LDV o la prenotazione del ritiro non bastano.
      </div>
      <BarraRapidi rapidi={rapidi} attivo={rapido} imposta={setRapido} base={pre} />
      <BarraFiltri defs={defs} valori={filtri} imposta={imposta} azzera={azzera} />

      {inRitardo.length > 0 && (
        <div className="collapse">
          <button className="collapse-head" onClick={() => setRitardoAperto(v => !v)}
            aria-expanded={ritardoAperto}>
            <span aria-hidden>{ritardoAperto ? '▾' : '▸'}</span>
            <b>In ritardo</b>
            <span className="n">{inRitardo.length}</span>
            <span className="hint">data prevista già superata — {ritardoAperto ? 'nascondi' : 'mostra'}</span>
          </button>
          {ritardoAperto && <Tabella lista={inRitardo} oggi={oggi} apri={apri} />}
        </div>
      )}

      {!lista.length ? <Vuoto testo="Nessun ordine con i filtri attivi." />
        : <Tabella lista={lista} oggi={oggi} apri={apri} />}
    </>
  );
}
