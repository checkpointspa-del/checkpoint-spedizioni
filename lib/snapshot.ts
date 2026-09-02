/**
 * CONTRATTO CONDIVISO fra checkpoint-tracking (che scrive) e questa app (che legge).
 *
 * Perché esiste.
 * Le tappe di una spedizione vivono nei fulfillment event di Shopify. Leggerli in
 * GraphQL per una lista di ordini costa N × spedizioni × eventi punti di costo: a
 * 600 ordini la query supera di molto il limite e il cruscotto diventa inusabile.
 *
 * La soluzione non è un database parallelo, è scrivere UNA VOLTA il riassunto
 * calcolato dentro Shopify, su un metafield dell'ordine. Il webhook ShippyPro che
 * checkpoint-tracking già riceve aggiorna il metafield nello stesso passaggio in cui
 * scrive il fulfillment event: nessun servizio nuovo, nessun polling.
 *
 * Il riassunto contiene solo FATTI: date e stato grezzo dichiarato da Shopify, più il
 * testo originale del corriere. L'interpretazione (giacenza, indirizzo errato, rientro
 * al mittente) la fa questa app, così cambiarla non obbliga a rifare il backfill.
 *
 * Il metafield è un riassunto, non la verità: la verità restano i fulfillment event,
 * che la scheda di dettaglio e la vista contestazione leggono per intero sul singolo
 * ordine. Se il riassunto manca, l'app lo ricalcola al volo per quell'ordine e lo
 * dichiara come tale — non lo inventa e non lo nasconde.
 *
 * Metafield: namespace `checkpoint`, key `spedizione_stato`, type `json`.
 */
export const METAFIELD_SNAPSHOT = { namespace: 'checkpoint', key: 'spedizione_stato' } as const;

/** Versione del formato: se cambia, il lettore sa di avere davanti un dato vecchio. */
export const SNAPSHOT_VERSION = 1;

export interface SnapshotSpedizione {
  /** GID del fulfillment Shopify */
  fulfillmentId: string;
  tracking: string | null;
  corriere: string | null;
  /** creazione della LDV: primo evento registrato sul fulfillment */
  trackAt: string | null;
  /** presa in carico EFFETTIVA: primo evento che prova l'uscita dal magazzino */
  presaAt: string | null;
  /** stato Shopify dell'evento che ha determinato la presa in carico */
  presaStatus: string | null;
  /**
   * true quando il corriere non ha mai notificato il ritiro e la data è stata
   * dedotta dal primo evento successivo: è una stima per eccesso, e va detto.
   */
  presaApprossimata: boolean;
  consegnaAt: string | null;
  ultimoEventoAt: string | null;
  ultimoEventoStatus: string | null;
  ultimoEventoMessaggio: string | null;
  ultimoEventoLuogo: string | null;
  numeroEventi: number;
}

export interface SnapshotOrdine {
  v: number;
  /** quando il riassunto è stato scritto */
  aggiornatoIl: string;
  /**
   * Chi lo ha scritto. `creazione` e' il percorso di checkpoint-tracking che scrive il
   * riassunto quando il fulfillment nasce o cambia tracking: in quel momento gli eventi
   * possono non esserci ancora, quindi produce riassunti con `numeroEventi: 0`.
   * Va dichiarato qui, non subito in silenzio.
   */
  sorgente: 'webhook' | 'backfill' | 'ricalcolo-app' | 'creazione';
  spedizioni: SnapshotSpedizione[];
}

export function snapshotVuoto(sorgente: SnapshotOrdine['sorgente'] = 'ricalcolo-app'): SnapshotOrdine {
  return { v: SNAPSHOT_VERSION, aggiornatoIl: new Date().toISOString(), sorgente, spedizioni: [] };
}

/** Parsing difensivo: un metafield corrotto o di versione ignota vale come assente. */
export function leggiSnapshot(valore: string | null | undefined): SnapshotOrdine | null {
  if (!valore) return null;
  try {
    const j = JSON.parse(valore) as SnapshotOrdine;
    if (!j || typeof j !== 'object' || j.v !== SNAPSHOT_VERSION) return null;
    if (!Array.isArray(j.spedizioni)) return null;
    return j;
  } catch { return null; }
}
