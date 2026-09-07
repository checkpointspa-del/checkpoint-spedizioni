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

/* ------------------------------------------------------------------------- *
 * `displayStatus` DEL FULFILLMENT — la rete di sicurezza sotto al riassunto.
 *
 * PERCHE' SERVE. Nelle liste gli eventi non si leggono (costo N×F×E): lo stato
 * arriva dal metafield `spedizione_stato`, che checkpoint-tracking scrive. Ma quel
 * metafield puo' restare INDIETRO, e sui dati reali resta indietro spesso: il
 * percorso `creazione` lo scrive quando il fulfillment nasce, con `numeroEventi: 0`,
 * e se il webhook non lo aggiorna piu' il riassunto continua a dire "nessun evento"
 * per sempre.
 *
 * Caso reale 26CKPT2972 (07/09): riassunto scritto l'1/09 con presaAt null e zero
 * eventi; Shopify sullo stesso fulfillment dice `OUT_FOR_DELIVERY` e ha due eventi.
 * Il cruscotto mostrava l'ordine come "da spedire, collo fermo in magazzino" mentre
 * il pacco era sul furgone in consegna.
 *
 * `displayStatus` e' UN CAMPO: sta gia' nella query di lista e non costa nulla.
 * E' meno preciso del riassunto — non porta date — ma e' sempre aggiornato.
 * REGOLA: il riassunto e' la fonte delle DATE, `displayStatus` e' la fonte dello
 * STATO. Quando i due si contraddicono, vince la piattaforma.
 * ------------------------------------------------------------------------- */

/** Valori di Fulfillment.displayStatus che PROVANO l'uscita dal magazzino. */
export const USCITA_DA_DISPLAY: readonly string[] = [
  'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP', 'ATTEMPTED_DELIVERY', 'DELIVERED'
];

/**
 * NON sono prova di uscita, e la distinzione conta:
 * `FULFILLED` e `MARKED_AS_FULFILLED` dicono solo che l'ordine e' stato evaso nel
 * gestionale — la LDV esiste, il collo puo' essere ancora sul bancone. Verificato su
 * 26CKPT2619 e 26CKPT2620, entrambi FULFILLED e fermi in magazzino.
 */
const STATO_DA_DISPLAY: Record<string, StatoNormalizzato> = {
  LABEL_PURCHASED:    'tracking_creato',
  LABEL_PRINTED:      'tracking_creato',
  CONFIRMED:          'tracking_creato',
  SUBMITTED:          'tracking_creato',
  FULFILLED:          'tracking_creato',
  MARKED_AS_FULFILLED:'tracking_creato',
  PICKED_UP:          'preso_in_carico',
  IN_TRANSIT:         'in_transito',
  OUT_FOR_DELIVERY:   'in_consegna',
  READY_FOR_PICKUP:   'pronta_per_ritiro',
  ATTEMPTED_DELIVERY: 'destinatario_assente',
  DELIVERED:          'consegnata',
  NOT_DELIVERED:      'eccezione',
  FAILURE:            'eccezione'
};

export const provaUscitaDaDisplay = (displayStatus?: string | null): boolean =>
  Boolean(displayStatus && USCITA_DA_DISPLAY.includes(displayStatus));

/** `null` quando Shopify non dice nulla di utile: non si inventa uno stato. */
export const statoDaDisplay = (displayStatus?: string | null): StatoNormalizzato | null =>
  (displayStatus && STATO_DA_DISPLAY[displayStatus]) || null;
