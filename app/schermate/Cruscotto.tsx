'use client';
import type { OrdineApp } from '@/lib/classify';
import type { Config } from '@/lib/config';
import { Badge, GruppoBadge, etichettaCausaDati, etichettaCausaSped, BADGE_GRAVITA } from '../ui';
import type { Vista } from '../page';

const oggiRoma = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export interface Indicatore {
  etichetta: string; valore: number; nota: string; tono: string;
  vai: { vista: Vista; rapido?: string };
}

export function indicatori(ordini: OrdineApp[]): Indicatore[] {
  const oggi = oggiRoma();
  const n = (f: (o: OrdineApp) => unknown) => ordini.filter(f).length;

  return [
    { etichetta: 'Ordini da spedire oggi', valore: n(o => o.fase === 'da_spedire' && o.prevista === oggi),
      nota: 'previsti per oggi', tono: 'k-info', vai: { vista: 'spedire', rapido: 'oggi' } },
    { etichetta: 'Tracking creato, non ancora ritirato', valore: n(o => o.fase === 'da_spedire' && o.tracking),
      nota: 'in attesa di presa in carico', tono: 'k-warn', vai: { vista: 'spedire', rapido: 'attesa' } },
    { etichetta: 'Spedizioni da monitorare', valore: n(o => o.fase === 'da_monitorare'),
      nota: 'in viaggio', tono: 'k-info', vai: { vista: 'monitorare' } },
    { etichetta: 'Spedizioni in consegna', valore: n(o => o.stato === 'in_consegna'),
      nota: 'ultimo miglio', tono: 'k-info', vai: { vista: 'monitorare', rapido: 'consegna' } },
    { etichetta: 'Oltre i tempi stimati', valore: n(o => o.fase === 'da_monitorare' && o.ritardoGG > 0),
      nota: 'fuori finestra prevista', tono: 'k-urg', vai: { vista: 'monitorare', rapido: 'ritardo' } },
    { etichetta: 'Alert sui dati', valore: n(o => o.alertDati.length),
      nota: 'tag e date da sistemare', tono: 'k-warn', vai: { vista: 'dati' } },
    { etichetta: 'Alert di spedizione', valore: n(o => o.alertSpedizione.length),
      nota: `${n(o => o.gravitaSpedizione === 'critico')} critici`, tono: 'k-crit', vai: { vista: 'alert' } },
    { etichetta: 'Ticket da aprire', valore: n(o => o.ticketDaAprire),
      nota: 'azione richiesta', tono: 'k-urg', vai: { vista: 'ticket', rapido: 'da_aprire' } },
    { etichetta: 'Ticket già aperti', valore: n(o => o.ticketAperto),
      nota: 'in lavorazione', tono: 'k-info', vai: { vista: 'ticket', rapido: 'aperti' } },
    { etichetta: 'In attesa di ritiro da oltre 24 h', valore: n(o => (o.oreAttesaRitiro ?? 0) > 24),
      nota: 'il corriere non è ancora passato', tono: 'k-urg', vai: { vista: 'spedire', rapido: 'attesa' } }
  ];
}

export default function Cruscotto(
  { ordini, config, vai, apri }:
  { ordini: OrdineApp[]; config: Config; vai: (v: Vista, rapido?: string) => void; apri: (id: string) => void }
) {
  const attivi = ordini.filter(o => o.attivo);
  const gruppi = new Map<string, { b2b: boolean; tot: number; spedire: number; viaggio: number; ad: number; as: number }>();
  for (const o of attivi) {
    const g = gruppi.get(o.gruppo) ?? { b2b: o.isB2B, tot: 0, spedire: 0, viaggio: 0, ad: 0, as: 0 };
    g.tot++;
    if (o.fase === 'da_spedire') g.spedire++; else g.viaggio++;
    if (o.alertDati.length) g.ad++;
    if (o.alertSpedizione.length) g.as++;
    gruppi.set(o.gruppo, g);
  }
  const righe = [...gruppi.entries()]
    .sort((a, b) => (a[1].b2b !== b[1].b2b ? (a[1].b2b ? 1 : -1) : a[0].localeCompare(b[0])));

  const topDati = ordini.filter(o => o.alertDati.length).slice(0, 6);
  const topSped = [...ordini.filter(o => o.alertSpedizione.length)]
    .sort((a, b) => (b.ritardoGG - a.ritardoGG)).slice(0, 6);

  return (
    <>
      <div className="kpis">
        {indicatori(ordini).map(k => (
          <button key={k.etichetta} className={`kpi ${k.tono}`} onClick={() => vai(k.vai.vista, k.vai.rapido)}>
            <span className="lbl">{k.etichetta}</span>
            <span className="val">{k.valore}</span>
            <span className="foot">{k.nota}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Società sportive <span className="muted" style={{ fontWeight: 400 }}>core business</span>
          <span className="right">Il gruppo {config.etichettaB2B} resta sempre in fondo</span></h2>
        <div className="tw">
          <table>
            <thead><tr><th>Gruppo</th><th>Attivi</th><th>Da spedire</th><th>In viaggio</th><th>Alert dati</th><th>Alert sped.</th></tr></thead>
            <tbody>
              {righe.map(([nome, g]) => (
                <tr key={nome} className={g.b2b ? 'b2b-row' : ''}>
                  <td>{g.b2b ? <Badge tipo="b2b">{config.etichettaB2B}</Badge> : <b>{nome}</b>}</td>
                  <td className="num">{g.tot}</td><td className="num">{g.spedire}</td><td className="num">{g.viaggio}</td>
                  <td className="num">{g.ad ? <Badge tipo="warn">{g.ad}</Badge> : <span className="muted">0</span>}</td>
                  <td className="num">{g.as ? <Badge tipo="urg">{g.as}</Badge> : <span className="muted">0</span>}</td>
                </tr>
              ))}
              {!righe.length && <tr><td colSpan={6} className="empty">Nessun ordine attivo.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))', gap: 14, marginTop: 14 }}>
        <div className="card">
          <h2>⚑ Alert dati <span className="right"><button className="btn" onClick={() => vai('dati')}>apri sezione</button></span></h2>
          <div className="pad alist">
            {topDati.map(o => (
              <div key={o.id} className={`acard sev-${o.gravitaDati ?? 'attenzione'}`} onClick={() => apri(o.id)}>
                <div className="h"><span className="ordref">{o.nome}</span><GruppoBadge o={o} />
                  <span className="who">{o.cliente}</span></div>
                <div className="reasons">{o.alertDati.map(c => <Badge key={c} tipo="neutral">{etichettaCausaDati(c)}</Badge>)}</div>
              </div>
            ))}
            {!topDati.length && <div className="empty">Nessun alert dati.</div>}
          </div>
        </div>

        <div className="card">
          <h2>▲ Alert spedizione <span className="right"><button className="btn" onClick={() => vai('alert')}>apri sezione</button></span></h2>
          <div className="pad alist">
            {topSped.map(o => (
              <div key={o.id} className={`acard sev-${o.gravitaSpedizione ?? 'attenzione'}`} onClick={() => apri(o.id)}>
                <div className="h"><span className="ordref">{o.nome}</span><GruppoBadge o={o} />
                  <Badge tipo={BADGE_GRAVITA[o.gravitaSpedizione ?? 'attenzione']}>{o.gravitaSpedizione}</Badge>
                  <span className="who">{o.corriere ?? 'corriere non indicato'}</span></div>
                <div className="reasons">{o.alertSpedizione.map(a =>
                  <Badge key={a.causa} tipo={BADGE_GRAVITA[a.gravita]}>{etichettaCausaSped(a.causa)}</Badge>)}</div>
              </div>
            ))}
            {!topSped.length && <div className="empty">Nessun alert di spedizione.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
