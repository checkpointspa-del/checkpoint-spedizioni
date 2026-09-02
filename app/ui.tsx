'use client';
import type { OrdineApp } from '@/lib/classify';
import { STATI } from '@/lib/status';
import { CAUSE_DATI, CAUSE_SPEDIZIONE, STATI_TICKET, Gravita, StatoTicket } from '@/lib/alerts';

/* ---------- formattazione ---------- */
const TZ = 'Europe/Rome';
const fD  = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fDT = new Intl.DateTimeFormat('it-IT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export const D  = (v?: string | null) => v ? fD.format(new Date(v)) : '—';
export const DT = (v?: string | null) => v ? fDT.format(new Date(v)) : '—';
export const ND = <span className="nd">Dato non disponibile</span>;

export function trascorso(v?: string | null, ora = Date.now()): string {
  if (!v) return '—';
  const h = (ora - new Date(v).getTime()) / 3_600_000;
  if (h < 1)  return `${Math.max(1, Math.round(h * 60))} min fa`;
  if (h < 48) return `${Math.round(h)} h fa`;
  return `${Math.round(h / 24)} g fa`;
}

/* ---------- pezzi visivi ---------- */
export function Badge({ tipo, children }: { tipo: string; children: React.ReactNode }) {
  return <span className={`b b-${tipo}`}>{children}</span>;
}

/**
 * Codice di tracking, cliccabile quando una pagina esiste.
 *
 * UNICO punto in cui un tracking viene disegnato: liste, alert e dettaglio passano
 * tutti di qui, cosi' il comportamento del clic e' identico ovunque e non si sfilaccia.
 *
 * Tre dettagli che sembrano cosmetici e non lo sono:
 *  - `stopPropagation`: le righe delle tabelle aprono la scheda di dettaglio al clic.
 *    Senza, un clic sul tracking aprirebbe ANCHE il pannello, sopra la nuova scheda.
 *  - `rel="noopener noreferrer"`: la pagina aperta non deve poter toccare l'app.
 *  - senza URL resta testo semplice, non un link morto.
 */
export function Tracking(
  { codice, url, vuoto = '—', forte = false }:
  { codice?: string | null; url?: string | null; vuoto?: string; forte?: boolean }
) {
  if (!codice) return <span className="muted">{vuoto}</span>;
  const T = forte ? 'b' : 'span';
  if (!url) return <T className="tr-code">{codice}</T>;
  return (
    <a className="tr-code tr-link" href={url} target="_blank" rel="noopener noreferrer"
       onClick={e => e.stopPropagation()} title="Apri la pagina di tracking">
      {codice}<span className="tr-ext" aria-hidden>↗</span>
    </a>
  );
}

const BADGE_STATO: Record<string, string> = {
  pre: 'neutral', via: 'info', fine: 'ok', alt: 'urg'
};
export function StatoBadge({ o }: { o: OrdineApp }) {
  const info = STATI[o.stato];
  const tipo = o.stato === 'non_aggiornato' ? 'warn'
             : ['eccezione', 'rifiutata', 'rientro_mittente', 'indirizzo_errato'].includes(o.stato) ? 'crit'
             : BADGE_STATO[info.genere] ?? 'neutral';
  return <Badge tipo={tipo}>{info.label}</Badge>;
}

/**
 * Il ritiro in negozio e' fuori perimetro: se un ordine di ritiro compare in una
 * lista significa che una spedizione tracciata esiste davvero, ed e' un'eccezione
 * che l'operatore deve vedere subito — il cliente potrebbe presentarsi in negozio
 * per merce che sta viaggiando. Sta dentro GruppoBadge perche' quel componente e'
 * gia' presente in ogni riga e nel dettaglio: nessuna duplicazione.
 */
export function GruppoBadge({ o }: { o: OrdineApp }) {
  const ritiro = o.ritiroInNegozio ? <> <Badge tipo="warn">ritiro in negozio, ma spedito</Badge></> : null;
  /* Stessa logica del ritiro: un ordine rimborsato e' fuori perimetro, se compare
     e' perche' la merce viaggia lo stesso. Va letto prima di tutto il resto. */
  const rimborso = o.rimborsatoTotale ? <> <Badge tipo="crit">rimborsato, merce in viaggio</Badge></> : null;
  if (o.isB2C) return <><Badge tipo="b2c">B2C</Badge>{rimborso}{ritiro}</>;
  return (
    <>
      <Badge tipo="soc">{o.socNome}</Badge>
      {!o.socCompleta && <> <Badge tipo="warn">dati incompleti</Badge></>}
      {rimborso}
      {ritiro}
    </>
  );
}

export function Progresso({ o }: { o: OrdineApp }) {
  const info = STATI[o.stato];
  const alt = info.genere === 'alt';
  return (
    <div className="prog">
      {[1, 2, 3, 4].map(k => {
        const on = k <= info.step;
        return <i key={k} className={[on && 'f', on && alt && 'alt', on && !alt && o.ritardoGG && 'late']
          .filter(Boolean).join(' ')} />;
      })}
      <span>{info.label}</span>
    </div>
  );
}

export function Finestra({ o }: { o: OrdineApp }) {
  if (!o.etaMax) return <span className="muted">—</span>;
  const t = `${D(o.etaMin)} – ${D(o.etaMax)}`;
  if (o.ritardoGG)  return <>{t} <Badge tipo="crit">+{o.ritardoGG} gg lav.</Badge></>;
  if (o.inScadenza) return <>{t} <Badge tipo="warn">in scadenza</Badge></>;
  return <>{t} <Badge tipo="ok">nei tempi</Badge></>;
}

export const BADGE_GRAVITA: Record<Gravita, string> =
  { informativo: 'info', attenzione: 'warn', urgente: 'urg', critico: 'crit' };

export function TicketBadge({ stato }: { stato: StatoTicket }) {
  const tipo = stato === 'ticket_da_aprire' ? 'urg'
             : stato === 'risolto' ? 'ok'
             : ['ticket_aperto', 'attesa_corriere', 'risposta_ricevuta'].includes(stato) ? 'info' : 'neutral';
  return <Badge tipo={tipo}>{STATI_TICKET[stato]}</Badge>;
}

export const etichettaCausaDati = (c: keyof typeof CAUSE_DATI) => CAUSE_DATI[c].label;
export const etichettaCausaSped = (c: keyof typeof CAUSE_SPEDIZIONE) => CAUSE_SPEDIZIONE[c].label;

/** Il gruppo B2C (privati senza tag società) sta sempre in fondo, con qualsiasi ordinamento. */
export function b2cInFondo<T extends { isB2C: boolean }>(cmp: (a: T, b: T) => number) {
  return (a: T, b: T) => (a.isB2C !== b.isB2C ? (a.isB2C ? 1 : -1) : cmp(a, b));
}

export function Vuoto({ testo }: { testo: string }) {
  return <div className="card"><div className="empty">{testo}</div></div>;
}
