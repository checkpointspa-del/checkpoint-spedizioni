/**
 * Aritmetica delle date nel fuso Europe/Rome.
 *
 * Serve a una cosa sola: calcolare la finestra di consegna attesa e capire di
 * quanto una spedizione attiva la sta superando. I giorni lavorativi escludono
 * sabato, domenica e il calendario delle festività configurabile.
 *
 * Qui non si misurano prestazioni: i tempi statistici sono fuori perimetro.
 */
export const TZ = 'Europe/Rome';

const FMT_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
});

/** Data civile a Roma nel formato AAAA-MM-GG. */
export function ymd(d: Date | string): string {
  return FMT_YMD.format(typeof d === 'string' ? new Date(d) : d);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

const cacheFeriale = new Map<string, boolean>();

/** true se la data civile è un giorno lavorativo secondo il calendario passato. */
export function isFeriale(iso: string, festivi: readonly string[]): boolean {
  const key = `${iso}|${festivi.length}`;
  const hit = cacheFeriale.get(key);
  if (hit !== undefined) return hit;
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const v = dow !== 0 && dow !== 6 && !festivi.includes(iso);
  cacheFeriale.set(key, v);
  return v;
}

/** Aggiunge n giorni lavorativi a una data, conservando l'orario. */
export function addGiorniLavorativi(from: Date | string, n: number, festivi: readonly string[]): Date {
  let d = new Date(from);
  let aggiunti = 0;
  while (aggiunti < n) {
    d = new Date(d.getTime() + 86_400_000);
    if (isFeriale(ymd(d), festivi)) aggiunti++;
  }
  return d;
}

/** Giorni lavorativi INTERI fra due istanti (0 se stessa data civile). */
export function giorniLavorativiInteri(a: Date | string, b: Date | string, festivi: readonly string[]): number {
  const fine = new Date(b);
  let d = new Date(a);
  if (fine < d) return 0;
  const target = ymd(fine);
  let c = 0;
  let guard = 0;
  while (ymd(d) !== target) {
    d = new Date(d.getTime() + 86_400_000);
    if (isFeriale(ymd(d), festivi)) c++;
    if (++guard > 3650) break; // protezione contro date corrotte
  }
  return c;
}

export const oreDa = (d: Date | string | null, ora: Date = new Date()): number | null =>
  d ? (ora.getTime() - new Date(d).getTime()) / 3_600_000 : null;
