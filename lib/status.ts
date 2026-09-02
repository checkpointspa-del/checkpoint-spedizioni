/**
 * Stati normalizzati del cruscotto.
 *
 * ATTENZIONE — differenza importante rispetto al prototipo di Fase 1.
 * La sorgente degli eventi in esercizio non è ShippyPro ma i FULFILLMENT EVENT
 * di Shopify, che l'app checkpoint-tracking già scrive. Shopify accetta 11 stati
 * e vi collassa i ~34 stati ShippyPro: da qui non arrivano "giacenza",
 * "indirizzo errato" o "rientro al mittente".
 *
 * Quindi la granularità si recupera in due modi, in quest'ordine:
 *   1. il campo `message` dell'evento, che conserva la descrizione originale del
 *      corriere (viene ispezionato solo per RAFFINARE uno stato, mai per crearne
 *      uno che l'enum Shopify contraddice);
 *   2. i tag applicativi già previsti dall'analisi (`spedizione-problema`,
 *      `reso-in-rientro`).
 *
 * Dove il raffinamento non è possibile, lo stato resta quello dichiarato da
 * Shopify: nessuna deduzione inventata.
 */

export type FulfillmentEventStatus =
  | 'CONFIRMED' | 'LABEL_PURCHASED' | 'LABEL_PRINTED' | 'CARRIER_PICKED_UP'
  | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'READY_FOR_PICKUP' | 'ATTEMPTED_DELIVERY'
  | 'DELAYED' | 'DELIVERED' | 'FAILURE';

export type StatoNormalizzato =
  | 'senza_tracking' | 'tracking_creato' | 'in_attesa_ritiro'
  | 'preso_in_carico' | 'in_transito' | 'in_consegna' | 'consegnata'
  | 'ferma' | 'eccezione' | 'indirizzo_errato' | 'destinatario_assente'
  | 'rifiutata' | 'giacenza' | 'rientro_mittente' | 'pronta_per_ritiro'
  | 'non_aggiornato' | 'sconosciuto';

export type GenereStato = 'pre' | 'via' | 'alt' | 'fine';

export const STATI: Record<StatoNormalizzato, { label: string; step: 0|1|2|3|4; genere: GenereStato }> = {
  senza_tracking:      { label: 'Senza tracking',          step: 0, genere: 'pre'  },
  tracking_creato:     { label: 'Tracking creato',         step: 0, genere: 'pre'  },
  in_attesa_ritiro:    { label: 'In attesa di ritiro',     step: 0, genere: 'pre'  },
  preso_in_carico:     { label: 'Preso in carico',         step: 1, genere: 'via'  },
  in_transito:         { label: 'In transito',             step: 2, genere: 'via'  },
  in_consegna:         { label: 'In consegna',             step: 3, genere: 'via'  },
  pronta_per_ritiro:   { label: 'Disponibile per il ritiro', step: 3, genere: 'via' },
  consegnata:          { label: 'Consegnata',              step: 4, genere: 'fine' },
  ferma:               { label: 'Ferma',                   step: 2, genere: 'alt'  },
  eccezione:           { label: 'Eccezione',               step: 2, genere: 'alt'  },
  indirizzo_errato:    { label: 'Indirizzo errato',        step: 3, genere: 'alt'  },
  destinatario_assente:{ label: 'Destinatario assente',    step: 3, genere: 'alt'  },
  rifiutata:           { label: 'Rifiutata',               step: 3, genere: 'alt'  },
  giacenza:            { label: 'Giacenza',                step: 3, genere: 'alt'  },
  rientro_mittente:    { label: 'Rientro al mittente',     step: 3, genere: 'alt'  },
  non_aggiornato:      { label: 'Tracking non aggiornato', step: 2, genere: 'alt'  },
  sconosciuto:         { label: 'Stato sconosciuto',       step: 0, genere: 'alt'  }
};

/**
 * Eventi che provano l'uscita fisica del collo dal magazzino.
 * CONFIRMED, LABEL_PURCHASED e LABEL_PRINTED sono deliberatamente esclusi:
 * la creazione della LDV non è una presa in carico.
 * DELAYED è escluso perché può comparire anche prima del ritiro.
 */
export const PRESA_IN_CARICO: readonly FulfillmentEventStatus[] = [
  'CARRIER_PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP', 'ATTEMPTED_DELIVERY', 'DELIVERED'
];

const BASE: Record<FulfillmentEventStatus, StatoNormalizzato> = {
  CONFIRMED:          'tracking_creato',
  LABEL_PURCHASED:    'tracking_creato',
  LABEL_PRINTED:      'tracking_creato',
  CARRIER_PICKED_UP:  'preso_in_carico',
  IN_TRANSIT:         'in_transito',
  OUT_FOR_DELIVERY:   'in_consegna',
  READY_FOR_PICKUP:   'pronta_per_ritiro',
  ATTEMPTED_DELIVERY: 'destinatario_assente',
  DELAYED:            'ferma',
  DELIVERED:          'consegnata',
  FAILURE:            'eccezione'
};

/** Raffinamenti ammessi, per stato di partenza. Non cambiano mai il senso dell'enum Shopify. */
const RAFFINA: Array<{ da: StatoNormalizzato[]; re: RegExp; a: StatoNormalizzato }> = [
  { da: ['ferma', 'eccezione', 'destinatario_assente'], re: /giacenz|on hold|available for pickup|fermo posta/i, a: 'giacenza' },
  { da: ['ferma', 'eccezione', 'destinatario_assente'], re: /indirizz|address/i,                                  a: 'indirizzo_errato' },
  { da: ['ferma', 'eccezione'],                          re: /rifiut|refus|reject/i,                              a: 'rifiutata' },
  { da: ['ferma', 'eccezione'],                          re: /rientro|return to sender|mittente/i,                a: 'rientro_mittente' },
  { da: ['ferma', 'eccezione'],                          re: /destinatario assente|recipient (not available|absent)/i, a: 'destinatario_assente' }
];

/** Stato normalizzato di un singolo evento, con eventuale raffinamento dal testo del corriere. */
export function statoDaEvento(status: string, message?: string | null): StatoNormalizzato {
  const base = BASE[status as FulfillmentEventStatus];
  if (!base) return 'sconosciuto';
  if (!message) return base;
  for (const r of RAFFINA) {
    if (r.da.includes(base) && r.re.test(message)) return r.a;
  }
  return base;
}

export const provaUscitaMagazzino = (status: string): boolean =>
  PRESA_IN_CARICO.includes(status as FulfillmentEventStatus);
