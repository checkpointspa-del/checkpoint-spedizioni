/**
 * Configurazione applicativa.
 *
 * I valori qui sotto sono i DEFAULT. In esercizio vengono sovrascritti dal metafield
 * `checkpoint.spedizioni_config` (JSON) sull'INSTALLAZIONE dell'app: la configurazione
 * vive dentro Shopify, è modificabile dall'app senza deploy, non richiede scope
 * aggiuntivi e non va definita a mano — si crea al primo salvataggio.
 */

export type ZonaId =
  | 'IT_STANDARD' | 'IT_SICILIA' | 'IT_SARDEGNA' | 'IT_CALABRIA'
  | 'IT_REMOTA' | 'UE' | 'EXTRA_UE';

export interface Finestra { label: string; min: number; max: number }

export interface Config {
  /** Finestre di consegna in giorni lavorativi dalla presa in carico effettiva. */
  finestre: Record<ZonaId, Finestra>;
  /** Regioni italiane con finestra dedicata. */
  regioniSpeciali: Record<string, ZonaId>;
  /** CAP di località remote o disagiate (elenchi dei corrieri). */
  capRemoti: string[];
  paesiUE: string[];
  /** Soglie degli alert di spedizione, indipendenti dalla data prevista. */
  soglie: {
    oreSenzaEventoDopoTracking: number;
    /** Collo non partito: da quante ore senza ALCUN evento diventa urgente, poi critico. */
    giorniColloNonPartitoUrgente: number;
    giorniColloNonPartitoCritico: number;
    oreMancataPresaInCarico: number;
    oreTrackingFermo: number;
    oreTrackingFermoCritico: number;
    giorniOltreFinestra: number;
    giorniPossibileSmarrimento: number;
    oreScadenzaImminente: number;
  };
  /** Calendario festività, data civile italiana. */
  festivi: string[];
  /** Etichetta del gruppo virtuale che raccoglie gli ordini senza tag società. */
  etichettaB2B: string;
  /**
   * Day 1 del cruscotto: gli ordini creati prima non entrano nel perimetro operativo.
   * Data fissa e non finestra mobile, così il perimetro non slitta da solo e nessun
   * ordine sparisce senza che qualcuno l'abbia deciso.
   *
   * ATTENZIONE: senza lo scope read_all_orders l'Admin API restituisce solo gli ultimi
   * 60 giorni, e lo fa in silenzio. Quando questa data supera i 60 giorni di età, il
   * cruscotto lo dichiara: a quel punto o si sposta in avanti, o si chiede lo scope.
   */
  dataInizio: string;
}

export const CONFIG_DEFAULT: Config = {
  finestre: {
    IT_STANDARD: { label: 'Italia (standard)',            min: 1, max: 2 },
    IT_SICILIA:  { label: 'Sicilia',                      min: 2, max: 3 },
    IT_SARDEGNA: { label: 'Sardegna',                     min: 2, max: 3 },
    IT_CALABRIA: { label: 'Calabria',                     min: 2, max: 3 },
    IT_REMOTA:   { label: 'Località remota o disagiata',  min: 4, max: 7 },
    UE:          { label: 'Unione Europea',               min: 3, max: 5 },
    EXTRA_UE:    { label: 'Europa extra-UE',              min: 4, max: 7 }
  },
  regioniSpeciali: { Sicilia: 'IT_SICILIA', Sardegna: 'IT_SARDEGNA', Calabria: 'IT_CALABRIA' },
  capRemoti: [],
  paesiUE: ['IT','FR','DE','ES','NL','BE','AT','PT','IE','SI','HR','GR','PL','CZ','SK','HU',
            'RO','BG','SE','DK','FI','EE','LV','LT','LU','MT','CY'],
  soglie: {
    oreSenzaEventoDopoTracking: 36,
    giorniColloNonPartitoUrgente: 3,
    giorniColloNonPartitoCritico: 7,
    oreMancataPresaInCarico: 48,
    oreTrackingFermo: 48,
    oreTrackingFermoCritico: 96,
    giorniOltreFinestra: 1,
    giorniPossibileSmarrimento: 7,
    oreScadenzaImminente: 24
  },
  festivi: [
    '2026-01-01','2026-01-06','2026-04-06','2026-04-25','2026-05-01','2026-06-02',
    '2026-08-15','2026-11-01','2026-12-08','2026-12-25','2026-12-26',
    '2027-01-01','2027-01-06','2027-03-29','2027-04-25','2027-05-01','2027-06-02',
    '2027-08-15','2027-11-01','2027-12-08','2027-12-25','2027-12-26'
  ],
  etichettaB2B: 'B2B',
  dataInizio: '2026-07-24'
};

export const METAFIELD_CONFIG = { namespace: 'checkpoint', key: 'spedizioni_config' } as const;
export const METAFIELD_TICKET = { namespace: 'checkpoint', key: 'spedizione_ticket' } as const;

/** Fonde la configurazione salvata con i default, un livello alla volta. */
export function mergeConfig(salvata: unknown): Config {
  if (!salvata || typeof salvata !== 'object') return CONFIG_DEFAULT;
  const s = salvata as Partial<Config>;
  return {
    ...CONFIG_DEFAULT,
    ...s,
    finestre: { ...CONFIG_DEFAULT.finestre, ...(s.finestre || {}) },
    regioniSpeciali: { ...CONFIG_DEFAULT.regioniSpeciali, ...(s.regioniSpeciali || {}) },
    soglie: { ...CONFIG_DEFAULT.soglie, ...(s.soglie || {}) }
  };
}
