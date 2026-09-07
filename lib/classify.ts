/**
 * Derivazione dell'ordine applicativo a partire dai dati Shopify.
 * È il cuore del dominio: nessuna regola di business vive nelle schermate.
 */
import { Config, ZonaId } from './config';
import { giorniLavorativiInteri, addGiorniLavorativi, oreDa } from './dates';
import { leggiTag, CHIAVI_SOC, ChiaveSoc } from './tags';
import { StatoNormalizzato, STATI, statoDaEvento, provaUscitaMagazzino,
         provaUscitaDaDisplay, statoDaDisplay } from './status';
import { SnapshotOrdine, SnapshotSpedizione, leggiSnapshot } from './snapshot';
import { CausaDati, CAUSE_DATI, CausaSpedizione, Gravita, ORDINE_GRAVITA, Ticket, StatoTicket } from './alerts';

/* ---------- forma dei dati in ingresso da Shopify ---------- */
export interface ShopifyEvento {
  id: string; status: string; happenedAt: string;
  message: string | null; city?: string | null; province?: string | null; country?: string | null;
}
export interface ShopifyFulfillment {
  id: string; createdAt: string; status: string; displayStatus: string | null;
  trackingInfo: { number: string | null; company: string | null; url: string | null }[];
  events?: { nodes: ShopifyEvento[] };
}
export interface ShopifyOrdine {
  id: string; name: string; createdAt: string; updatedAt: string;
  cancelledAt: string | null; cancelReason?: string | null;
  tags: string[]; note: string | null;
  displayFulfillmentStatus: string; displayFinancialStatus: string;
  currentSubtotalLineItemsQuantity: number;
  customer: { displayName: string | null } | null;
  shippingAddress: {
    name: string | null; city: string | null; province: string | null;
    provinceCode: string | null; country: string | null; countryCodeV2: string | null; zip: string | null;
  } | null;
  snapshot?: { value: string; updatedAt: string } | null;
  ticket?: { value: string; updatedAt: string } | null;
  refunds?: { id: string; createdAt: string }[];
  fulfillments: ShopifyFulfillment[];
  /**
   * Vero quando l'ordine e' `delivery_method:pick-up`.
   * Non arriva da un campo GraphQL: lo marca `store.ts` quando l'ordine proviene
   * dalla query di recupero dei ritiri. La query stessa e' l'informazione, quindi
   * il flag non costa un punto in piu'.
   */
  ritiroInNegozio?: boolean;
}

/* ---------- forma dei dati in uscita ---------- */
export type Fase = 'da_spedire' | 'da_monitorare' | 'consegnato' | 'chiuso';
export type Esito = 'consegnato' | 'in_corso' | 'annullato' | 'rimborsato';
export type FaseRitiro = 'senza_tracking' | 'tracking_creato' | 'in_attesa_ritiro' | 'preso_in_carico';

export interface SpedizioneApp extends SnapshotSpedizione {
  /**
   * Pagina di tracking, come la fornisce Shopify in `trackingInfo.url`.
   *
   * Su questo store punta alla pagina di tracking del negozio
   * (`check-point-store.it/pages/tracking-area?o=…&t=…`), non al portale del vettore:
   * e' la STESSA pagina che vede il cliente, quindi l'operatore al telefono guarda
   * esattamente cio' che gli viene descritto.
   *
   * NON si costruisce a mano da corriere + codice: una mappa di URL per vettore si
   * rompe in silenzio appena un corriere cambia formato, e un corriere nuovo resta
   * senza link finche' qualcuno non se ne accorge. Qui l'URL lo da' la piattaforma.
   *
   * Vive fuori dallo snapshot perche' non e' uno stato da ricordare: e' un campo
   * dell'ordine, sempre disponibile in entrambe le query.
   */
  trackingUrl: string | null;
  /**
   * Consegnata davvero.
   *
   * Vera se il riassunto ha una data di consegna OPPURE se Shopify dichiara il
   * fulfillment `displayStatus: DELIVERED`. Le due fonti non sono ridondanti: il
   * riassunto e' una cache e puo' restare indietro, `displayStatus` e' la piattaforma.
   * Vedi la nota su `consegnaAt` piu' sotto in classifica().
   */
  consegnata: boolean;
  /**
   * Il collo e' USCITO dal magazzino: o il riassunto ha una data di presa in carico,
   * o Shopify lo dichiara in movimento (`displayStatus`). Il fatto e' una cosa, la
   * DATA e' un'altra: qui c'e' solo il fatto. Vedi la nota in status.ts.
   */
  uscita: boolean;
  /** Stato dedotto da `displayStatus`, usato quando il riassunto non ha eventi. */
  statoDisplay: StatoNormalizzato | null;
  parziale: boolean;
  /** fulfillment CANCELLED: non governa lo stato e non conta per la consegna */
  annullata: boolean;
  eventi: ShopifyEvento[] | null;   // null = non caricati in questa vista
}

export interface OrdineApp {
  id: string; nome: string; ricezione: string; aggiornatoIl: string;
  cliente: string; articoli: number; note: string | null;
  destinazione: { citta: string; provincia: string; regione: string; paese: string; cap: string };

  /**
   * Ordine nato come ritiro in negozio ma con una spedizione tracciata: rientra nel
   * perimetro perche' la merce viaggia davvero, e va segnalato in interfaccia perche'
   * il cliente potrebbe presentarsi comunque in negozio.
   */
  ritiroInNegozio: boolean;

  /**
   * Rimborso totale: l'ordine e' fuori perimetro per definizione e se compare in una
   * lista significa che la merce e' gia' in viaggio — situazione da verificare subito.
   * `rimborsoParziale` invece non toglie nulla: resta merce da spedire.
   */
  rimborsatoTotale: boolean; rimborsoParziale: boolean;

  // classificazione commerciale
  isB2C: boolean; identificabile: boolean; socCompleta: boolean;
  socCodice: string; socNome: string; categoria: string; atleta: string; gruppo: string;

  // tag
  tags: string[]; prevista: string | null; previsteGrezze: string[];
  tagAlert: boolean; tagProblema: boolean; tagRientro: boolean;

  // spedizioni
  spedizioni: SpedizioneApp[];
  multiSped: boolean;
  tracking: string | null; corriere: string | null;
  /** Pagina di tracking della spedizione guida. Vedi SpedizioneApp.trackingUrl. */
  trackingUrl: string | null;
  snapshotPresente: boolean; snapshotSorgente: SnapshotOrdine['sorgente'] | null; snapshotAggiornatoIl: string | null;

  // stato
  stato: StatoNormalizzato; statoReale: StatoNormalizzato | null;
  faseRitiro: FaseRitiro; fase: Fase; esito: Esito; attivo: boolean;
  ultimoEventoAt: string | null; ultimoEventoMessaggio: string | null; ultimoEventoLuogo: string | null;
  oreUltimoEvento: number | null;

  // tempi
  trackAt: string | null; presaAt: string | null; presaAtUltima: string | null;
  /** la data di presa in carico è dedotta, non notificata dal corriere */
  presaApprossimata: boolean;
  consegnaUltima: string | null;
  /** ore dalla creazione della LDV senza che il corriere sia passato: serve al sollecito */
  oreAttesaRitiro: number | null;

  // finestra di consegna
  zona: ZonaId; etaMin: string | null; etaMax: string | null;
  ritardoGG: number; inScadenza: boolean;

  // alert
  alertDati: CausaDati[]; gravitaDati: Gravita | null;
  /**
   * Merce ancora nel NOSTRO magazzino: LDV creata, corriere che non e' passato.
   * Non e' un problema del vettore e non genera ticket: si lavora in "Da spedire".
   */
  alertMagazzino: { causa: CausaSpedizione; gravita: Gravita }[]; gravitaMagazzino: Gravita | null;
  /** Anomalie del VETTORE, solo su merce che ha gia' preso in carico. */
  alertSpedizione: { causa: CausaSpedizione; gravita: Gravita }[]; gravitaSpedizione: Gravita | null;
  anomalia: boolean;

  ticket: Ticket | null; ticketDaAprire: boolean; ticketAperto: boolean;

  ricerca: string;
}

/** Ricalcolo del riassunto dagli eventi, quando il metafield manca o è vecchio. */
export function calcolaSnapshot(o: ShopifyOrdine, sorgente: SnapshotOrdine['sorgente'] = 'ricalcolo-app'): SnapshotOrdine {
  const spedizioni: SnapshotSpedizione[] = o.fulfillments.map(f => {
    const ev = f.events?.nodes ?? [];
    const ordinati = [...ev].sort((a, b) => a.happenedAt.localeCompare(b.happenedAt));
    const presa = ordinati.find(e => provaUscitaMagazzino(e.status)) || null;
    const consegna = [...ordinati].reverse().find(e => e.status === 'DELIVERED') || null;
    const ultimo = ordinati.length ? ordinati[ordinati.length - 1] : null;
    const tr = f.trackingInfo?.[0];
    return {
      fulfillmentId: f.id,
      tracking: tr?.number ?? null,
      corriere: tr?.company ?? null,
      trackAt: ordinati.length ? ordinati[0].happenedAt : f.createdAt,
      presaAt: presa?.happenedAt ?? null,
      presaStatus: presa?.status ?? null,
      consegnaAt: consegna?.happenedAt ?? null,
      ultimoEventoAt: ultimo?.happenedAt ?? null,
      ultimoEventoStatus: ultimo?.status ?? null,
      ultimoEventoMessaggio: ultimo?.message ?? null,
      ultimoEventoLuogo: ultimo?.city ?? null,
      presaApprossimata: presa ? presa.status !== 'CARRIER_PICKED_UP' : false,
      numeroEventi: ordinati.length
    };
  });
  return { v: 1, aggiornatoIl: new Date().toISOString(), sorgente, spedizioni };
}

/**
 * Ritiro in negozio.
 *
 * L'informazione arriva SOLO dalla query di recupero in store.ts
 * (`delivery_method:pick-up`), che marca l'ordine.
 *
 * NON si legge da `fulfillmentOrders`: quel campo richiede lo scope
 * read_merchant_managed_fulfillment_orders, che questa app non ha e non deve
 * chiedere solo per un badge. Verificato in produzione l'1/09 —
 * "Admin API: Access denied for fulfillmentOrders field" rompeva l'INTERA
 * scheda di dettaglio, non solo il badge.
 */
export function eRitiroInNegozio(o: ShopifyOrdine): boolean {
  return Boolean(o.ritiroInNegozio);
}

/**
 * Stessa societa', due gruppi.
 *
 * PROBLEMA, misurato sul perimetro reale del 01/09: 231 ordini portano
 * `codice_soc=SPORTINGC2627`, ma solo 210 portano anche `soc_nome`. Gli altri 21
 * ripiegano sul codice, e la gerarchia mostra la stessa societa' due volte —
 * "SPORTING CASTELLANA" con 210 ordini e "SPORTINGC2627" con 21 — con conteggi
 * divisi, filtri divisi e riepiloghi che non tornano.
 *
 * CURA: il nome non si inventa, esiste gia' su altri ordini dello stesso codice.
 * Si sceglie il nome piu' frequente per ciascun codice e lo si applica a chi ne e'
 * privo. L'alert `soc_incompleta` resta: il tag manca davvero e va corretto a monte.
 * Si corregge la vista, non il dato.
 *
 * Opera sull'insieme, non sul singolo ordine: per questo sta qui e non in classifica().
 */
export function risolviNomiSocieta(ordini: OrdineApp[]): OrdineApp[] {
  const haNome = (x: OrdineApp) => x.tags.some(t => t.trim().startsWith('soc_nome='));

  const conteggi = new Map<string, Map<string, number>>();
  for (const x of ordini) {
    if (x.isB2C || !x.socCodice || !haNome(x)) continue;
    const m = conteggi.get(x.socCodice) ?? new Map<string, number>();
    m.set(x.socNome, (m.get(x.socNome) ?? 0) + 1);
    conteggi.set(x.socCodice, m);
  }

  const scelto = new Map<string, string>();
  for (const [codice, m] of conteggi) {
    // Piu' frequente; a parita', ordine alfabetico, cosi' il risultato e' stabile.
    const [nome] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    scelto.set(codice, nome);
  }
  if (!scelto.size) return ordini;

  return ordini.map(x => {
    if (x.isB2C || !x.socCodice || haNome(x)) return x;
    const nome = scelto.get(x.socCodice);
    if (!nome || nome === x.socNome) return x;
    return { ...x, socNome: nome, gruppo: nome, ricerca: `${x.ricerca} ${nome.toLowerCase()}` };
  });
}

function zonaDi(o: ShopifyOrdine, cfg: Config): ZonaId {
  const cc = o.shippingAddress?.countryCodeV2 || 'IT';
  const cap = (o.shippingAddress?.zip || '').replace(/\s/g, '');
  if (cc !== 'IT') return cfg.paesiUE.includes(cc) ? 'UE' : 'EXTRA_UE';
  if (cap && cfg.capRemoti.includes(cap)) return 'IT_REMOTA';
  const reg = o.shippingAddress?.province || '';
  return cfg.regioniSpeciali[reg] ?? 'IT_STANDARD';
}

export function classifica(o: ShopifyOrdine, cfg: Config, ora = new Date()): OrdineApp {
  const t = leggiTag(o.tags);

  /* --- ramo commerciale --- */
  const presenti = CHIAVI_SOC.filter(k => t.soc[k as ChiaveSoc]);
  const isB2C = presenti.length === 0;
  const identificabile = Boolean(t.soc.codice_soc || t.soc.soc_nome);
  const socCompleta = presenti.length === CHIAVI_SOC.length;
  const socNome = isB2C ? cfg.etichettaB2C : (t.soc.soc_nome || t.soc.codice_soc || 'Società non identificata');

  /* --- riassunto delle spedizioni --- */
  const snapSalvato = leggiSnapshot(o.snapshot?.value);
  const haEventi = o.fulfillments.some(f => f.events);
  const snap = snapSalvato ?? (haEventi ? calcolaSnapshot(o) : { v: 1, aggiornatoIl: '', sorgente: 'ricalcolo-app' as const, spedizioni: [] });

  const perFulfillment = new Map(snap.spedizioni.map(s => [s.fulfillmentId, s]));
  const spedizioni: SpedizioneApp[] = o.fulfillments.map((f, i) => {
    const tr = f.trackingInfo?.[0];
    const s = perFulfillment.get(f.id) ?? {
      fulfillmentId: f.id, tracking: tr?.number ?? null, corriere: tr?.company ?? null,
      trackAt: f.createdAt, presaAt: null, presaStatus: null, presaApprossimata: false, consegnaAt: null,
      ultimoEventoAt: null, ultimoEventoStatus: null, ultimoEventoMessaggio: null, ultimoEventoLuogo: null,
      numeroEventi: 0
    };
    /* UNA CACHE NON PUO' SMENTIRE LA PIATTAFORMA.
       Caso reale 26CKPT2619 (02/09): il tracking era sbagliato ed e' stato corretto a
       mano. checkpoint-tracking ha riscritto il riassunto dal percorso `creazione` un
       secondo dopo l'evento DELIVERED, salvandolo con `numeroEventi: 0` e
       `consegnaAt: null`. Risultato: Shopify diceva DELIVERED, il riassunto diceva di
       no, e l'ordine restava per sempre nel perimetro operativo.
       `displayStatus` sta gia' nella query di lista e non costa nulla: quando dichiara
       DELIVERED vince lui, sempre. Il riassunto resta la fonte delle DATE, mai quella
       del fatto che la consegna sia avvenuta. */
    const consegnata = Boolean(s.consegnaAt) || f.displayStatus === 'DELIVERED';
    /* Stessa regola applicata all'uscita dal magazzino: il riassunto puo' non avere
       ancora visto nulla, `displayStatus` invece e' sempre allineato. */
    const uscita = Boolean(s.presaAt) || provaUscitaDaDisplay(f.displayStatus);
    return { ...s, trackingUrl: tr?.url ?? null, consegnata, uscita,
             statoDisplay: statoDaDisplay(f.displayStatus),
             parziale: o.fulfillments.length > 1,
             annullata: f.status === 'CANCELLED', eventi: f.events?.nodes ?? null };
  });

  /* SI LAVORA PER TRACKING — stessa regola di `valutaConsegnato` in checkpoint-tracking,
     che qui mancava. Un fulfillment senza codice non e' una spedizione autonoma: e' merce
     accorpata (il riassortimento evaso giorni dopo). Se governasse lui, un ordine con una
     LDV vera risulterebbe "Senza tracking" e il codice non comparirebbe da nessuna parte.
     Successo davvero su 26CKPT2839 l'1/09: due fulfillment, quello senza codice creato
     DOPO, Shopify lo restituisce per primo, e il cruscotto nascondeva 3UW1JS2038106.
     Le spedizioni annullate non governano nulla, come nel lato scrittura. */
  const attive = spedizioni.filter(s => !s.annullata);
  const conTracking = attive.filter(s => s.tracking);
  const guida = conTracking.length ? conTracking : attive;

  /* SPEDIZIONE GUIDA: la prima non consegnata. E' quella che l'operatore deve seguire,
     ed e' quella — e SOLO quella — su cui si misurano tempi, fase e alert.

     PERCHE' STA QUI E NON PIU' IN FONDO. Prima presaAt/trackAt erano aggregati su TUTTE
     le spedizioni: il minimo fra i ritiri, il minimo fra le LDV. Con un ordine misto la
     regola mentiva. Caso reale 26CKPT2620 (02/09): due colli, uno consegnato il 27/08 e
     uno con LDV dell'11/08 e ZERO eventi, cioe' mai partito dal magazzino.
     Ereditando il ritiro del collo consegnato, l'ordine risultava "da monitorare", con
     una finestra di consegna calcolata su una data che non c'entrava nulla: da li'
     `oltre_finestra`, un alert di spedizione e un ticket al corriere, per una merce che
     il corriere non ha mai ricevuto.

     I tempi di un collo non si ereditano da un altro collo. */
  const principale = guida.find(x => !x.consegnata) ?? guida[0];

  /* Il FATTO della consegna e la sua DATA sono due cose distinte: un fulfillment puo'
     risultare DELIVERED senza che il riassunto ne conosca il timestamp. Il perimetro si
     decide sul fatto; la data resta quella vera, o resta assente. */
  const tutteConsegnate = guida.length > 0 && guida.every(s => s.consegnata);
  const dateConsegna = guida.map(s => s.consegnaAt).filter(Boolean) as string[];
  const presate = guida.map(s => s.presaAt).filter(Boolean) as string[];

  const trackAt = principale?.trackAt ?? null;
  /** DATA della presa in carico: solo se il riassunto ce l'ha davvero. Non si deduce. */
  const presaAt = principale?.presaAt ?? null;
  /** FATTO della presa in carico: basta che la piattaforma dica che il collo si muove. */
  const uscitoDalMagazzino = Boolean(principale?.uscita);
  /** Informativo: tutte le spedizioni dell'ordine sono uscite dal magazzino. */
  const presaAtUltima = presate.length === guida.length && presate.length ? presate.slice().sort().pop()! : null;
  const consegnaUltima = tutteConsegnate && dateConsegna.length ? dateConsegna.slice().sort().pop()! : null;

  /* --- esito e fase --- */
  /* Rimborsi: totale e parziale sono due cose diverse e non vanno confuse.
     TOTALE   -> l'ordine non verra' mai spedito. store.ts lo esclude alla sorgente e lo
                 riammette solo se la merce e' gia' partita (alert rimborsato_in_viaggio).
     PARZIALE -> resta merce da spedire, quindi resta nel perimetro come qualsiasi altro. */
  const rimborsatoTotale = o.displayFinancialStatus === 'REFUNDED';
  const rimborsoParziale = !rimborsatoTotale
    && (o.displayFinancialStatus === 'PARTIALLY_REFUNDED' || (o.refunds?.length ?? 0) > 0);
  const rimborsato = rimborsatoTotale || rimborsoParziale;
  const esito: Esito = o.cancelledAt ? 'annullato'
                     : tutteConsegnate ? (rimborsato ? 'rimborsato' : 'consegnato')
                     : 'in_corso';
  const fase: Fase = esito === 'annullato' ? 'chiuso'
                   : tutteConsegnate ? 'consegnato'
                   : (uscitoDalMagazzino ? 'da_monitorare' : 'da_spedire');
  const attivo = fase === 'da_spedire' || fase === 'da_monitorare';

  /* --- stato normalizzato dell'ordine ---
     Regola terminale: una spedizione consegnata non si monitora più. Se l'ordine ne ha
     altre ancora in viaggio, lo stato e gli alert seguono la prima NON consegnata
     (`principale`, calcolata sopra insieme ai tempi). */
  const oreUltimoEvento = oreDa(principale?.ultimoEventoAt ?? null, ora);
  let stato: StatoNormalizzato =
      !principale?.tracking ? 'senza_tracking'
    : principale.ultimoEventoStatus
      ? statoDaEvento(principale.ultimoEventoStatus, principale.ultimoEventoMessaggio)
      : (principale?.statoDisplay ?? 'tracking_creato');
  /* Se la spedizione guida risulta consegnata, lo stato e' quello e basta: senza questa
     riga un fulfillment DELIVERED privo di eventi nel riassunto sarebbe mostrato come
     "Tracking creato", cioe' l'esatto contrario della realta'. */
  if (principale?.consegnata) stato = 'consegnata';
  if (t.tagRientro && stato !== 'consegnata') stato = 'rientro_mittente';
  let statoReale: StatoNormalizzato | null = null;
  if (!uscitoDalMagazzino && principale?.tracking && stato === 'tracking_creato'
      && (oreDa(trackAt, ora) ?? 0) > 12) stato = 'in_attesa_ritiro';
  if (STATI[stato]?.genere === 'via' && oreUltimoEvento !== null
      && oreUltimoEvento > cfg.soglie.oreTrackingFermo) { statoReale = stato; stato = 'non_aggiornato'; }

  const faseRitiro: FaseRitiro = !principale?.tracking ? 'senza_tracking'
    : uscitoDalMagazzino ? 'preso_in_carico'
    : ((oreDa(trackAt, ora) ?? 0) > 12 ? 'in_attesa_ritiro' : 'tracking_creato');

  /* --- finestra di consegna --- */
  const zona = zonaDi(o, cfg);
  const fin = cfg.finestre[zona];
  const etaMin = presaAt ? addGiorniLavorativi(presaAt, fin.min, cfg.festivi).toISOString() : null;
  const etaMax = presaAt ? addGiorniLavorativi(presaAt, fin.max, cfg.festivi).toISOString() : null;
  const ritardoGG = etaMax && ora > new Date(etaMax) ? giorniLavorativiInteri(etaMax, ora, cfg.festivi) : 0;
  const inScadenza = Boolean(etaMax) && !ritardoGG &&
    (new Date(etaMax!).getTime() - ora.getTime()) < cfg.soglie.oreScadenzaImminente * 3_600_000;
  /* Attesa del ritiro: quante ore la LDV esiste senza che il corriere sia passato.
     Non è una statistica, è il numero su cui si decide se sollecitare. */
  const oreAttesaRitiro = (!uscitoDalMagazzino && trackAt) ? oreDa(trackAt, ora) : null;

  /* --- alert dati --- */
  const alertDati: CausaDati[] = [];
  if (attivo) {
    /* Primo in lista perche' e' il piu' grave: soldi resi e merce partita insieme. */
    if (rimborsatoTotale && fase === 'da_monitorare') alertDati.push('rimborsato_in_viaggio');
    if (t.tagAlert) alertDati.push('tag_alert');
    /* Il tag manca o e' scritto male: quello si', e' un dato da correggere.
       Una data SUPERATA no: e' un ritardo, non un errore, e vive in "Da spedire".
       Vedi la nota in alerts.ts — non reintrodurre `data_passata`. */
    if (!t.previsteGrezze.length) alertDati.push('data_mancante');
    else if (!t.previsteValide.length) alertDati.push('data_non_valida');
    if (identificabile && !socCompleta) alertDati.push('soc_incompleta');
    /* NIENTE alert per il tracking assente: stessa nota, stessa ragione. */
    if (t.previsteGrezze.length > 1 || t.duplicati.length) alertDati.push('tag_conflitto');
    if (stato === 'sconosciuto') alertDati.push('stato_non_interpretabile');
  }
  const gravitaDati = alertDati.length
    ? alertDati.map(c => CAUSE_DATI[c].gravita).sort((a, b) => ORDINE_GRAVITA[b] - ORDINE_GRAVITA[a])[0] : null;

  /* --- alert: DUE famiglie, mai mescolate (vedi CAUSE_MAGAZZINO in alerts.ts) ---
     MAGAZZINO  -> la merce e' ancora da noi. Si lavora in "Da spedire".
     SPEDIZIONE -> il corriere ce l'ha. Si lavora in "Alert spedizione", e solo da qui
                   puo' nascere un ticket al vettore.
     Il discrimine e' la presa in carico, cioe' la fase. */
  const inMagazzino = new Map<CausaSpedizione, Gravita>();
  const raccolti = new Map<CausaSpedizione, Gravita>();
  const accumula = (m: Map<CausaSpedizione, Gravita>) => (c: CausaSpedizione, g: Gravita) => {
    const cur = m.get(c);
    if (!cur || ORDINE_GRAVITA[g] > ORDINE_GRAVITA[cur]) m.set(c, g);
  };
  const addMag = accumula(inMagazzino);
  const add = accumula(raccolti);

  /* Merce ancora da noi: LDV creata, corriere che non l'ha mai presa in carico. */
  if (fase === 'da_spedire' && conTracking.length) {
    const oreTrack = oreDa(trackAt, ora) ?? 0;
    const soloUno = (principale?.numeroEventi ?? 0) <= 1;
    const S = cfg.soglie;
    /* Due situazioni diverse che prima producevano gli stessi due alert insieme.
       ZERO eventi = il corriere non ha mai visto il collo: e' fermo da noi.
       Eventi presenti ma nessuna prova di uscita = il corriere ha la LDV e non passa. */
    const senzaAlcunEvento = (principale?.numeroEventi ?? 0) === 0;
    if (senzaAlcunEvento && oreTrack > S.oreSenzaEventoDopoTracking) {
      const gg = oreTrack / 24;
      addMag('collo_non_partito',
          gg > S.giorniColloNonPartitoCritico ? 'critico'
        : gg > S.giorniColloNonPartitoUrgente ? 'urgente'
        : 'attenzione');
    }
    if (!senzaAlcunEvento) {
      if (soloUno && oreTrack > S.oreSenzaEventoDopoTracking)
        addMag('nessun_evento', oreTrack > S.oreMancataPresaInCarico ? 'urgente' : 'attenzione');
      if (oreTrack > S.oreMancataPresaInCarico)
        addMag('mancata_presa', oreTrack > S.oreMancataPresaInCarico * 2 ? 'urgente' : 'attenzione');
    }
  }

  /* Anomalie del VETTORE: solo su merce che il vettore ha davvero preso in carico. */
  if (fase === 'da_monitorare' && conTracking.length) {
    const S = cfg.soglie;
    if (presaAt && oreUltimoEvento !== null && oreUltimoEvento > S.oreTrackingFermo)
      add('tracking_fermo', oreUltimoEvento > S.oreTrackingFermoCritico ? 'urgente' : 'attenzione');
    if (ritardoGG >= S.giorniOltreFinestra) add('oltre_finestra', ritardoGG >= 3 ? 'critico' : 'urgente');
    if (presaAt && oreUltimoEvento !== null && oreUltimoEvento > S.giorniPossibileSmarrimento * 24)
      add('smarrimento', 'critico');
    const s = statoReale ?? stato;
    if (s === 'giacenza')              add('giacenza', 'urgente');
    if (s === 'destinatario_assente')  add('destinatario_assente', 'attenzione');
    if (s === 'indirizzo_errato')      add('indirizzo_errato', 'urgente');
    if (s === 'rifiutata')             add('rifiutata', 'critico');
    if (s === 'rientro_mittente')      add('rientro_mittente', 'critico');
    if (s === 'ferma')                 add('eccezione_corriere', 'attenzione');
    if (s === 'eccezione')             add(t.tagProblema ? 'danneggiata' : 'eccezione_corriere', t.tagProblema ? 'critico' : 'urgente');
    if (stato === 'sconosciuto')       add('non_riconosciuto', 'urgente');
  }
  const perGravita = (m: Map<CausaSpedizione, Gravita>) => [...m.entries()]
    .map(([causa, gravita]) => ({ causa, gravita }))
    .sort((a, b) => ORDINE_GRAVITA[b.gravita] - ORDINE_GRAVITA[a.gravita]);
  const alertMagazzino = perGravita(inMagazzino);
  const gravitaMagazzino = alertMagazzino.length ? alertMagazzino[0].gravita : null;
  const alertSpedizione = perGravita(raccolti);
  const gravitaSpedizione = alertSpedizione.length ? alertSpedizione[0].gravita : null;

  /* --- ticket --- */
  let ticket: Ticket | null = null;
  try { ticket = o.ticket?.value ? JSON.parse(o.ticket.value) as Ticket : null; } catch { ticket = null; }
  /* SENZA UNA SPEDIZIONE CHE IL VETTORE ABBIA DAVVERO NON SI APRE NULLA.
     Due condizioni, entrambe necessarie e per ragioni diverse:
      - `conTracking` -> senza codice non c'e' niente da chiedere al corriere;
      - `alertSpedizione` -> ora contiene SOLO anomalie del vettore su merce presa in
        carico. Un collo fermo nel nostro magazzino non arriva piu' fin qui, quindi
        nessun ticket viene proposto per merce che il corriere non ha mai ricevuto. */
  if (!ticket && conTracking.length && alertSpedizione.length) {
    const stato: StatoTicket = gravitaSpedizione
      && ORDINE_GRAVITA[gravitaSpedizione] >= ORDINE_GRAVITA.urgente
      ? 'ticket_da_aprire' : 'da_verificare';
    ticket = { stato, apertoIl: null, operatore: null, corriere: spedizioni[0]?.corriere ?? null,
               riferimento: null, note: null, aggiornatoIl: null, prossimoControllo: null, esito: null };
  }
  /* I due flag pilotano conteggi e liste "ticket corrieri": restano falsi senza una
     spedizione tracciata, anche se un metafield salvato in passato dice altro. Il ticket
     salvato resta leggibile nella scheda di dettaglio, ma non entra nel registro. */
  const ticketVerso = conTracking.length > 0;
  const ticketAperto = ticketVerso && Boolean(ticket
    && ['ticket_aperto', 'attesa_corriere', 'risposta_ricevuta'].includes(ticket.stato));

  const eventiAnomali = spedizioni.reduce((n, s) =>
    n + (s.eventi ?? []).filter(e => STATI[statoDaEvento(e.status, e.message)]?.genere === 'alt').length, 0);

  const dest = {
    citta: o.shippingAddress?.city ?? '', provincia: o.shippingAddress?.provinceCode ?? '',
    regione: o.shippingAddress?.province ?? '', paese: o.shippingAddress?.countryCodeV2 ?? '',
    cap: o.shippingAddress?.zip ?? ''
  };
  const cliente = o.customer?.displayName || o.shippingAddress?.name || 'Cliente non indicato';

  return {
    id: o.id, nome: o.name, ricezione: o.createdAt, aggiornatoIl: o.updatedAt,
    cliente, articoli: o.currentSubtotalLineItemsQuantity || 0, note: o.note,
    destinazione: dest,
    ritiroInNegozio: eRitiroInNegozio(o),
    rimborsatoTotale, rimborsoParziale,
    isB2C, identificabile, socCompleta,
    socCodice: t.soc.codice_soc ?? '', socNome,
    categoria: isB2C ? '—' : (t.soc.soc_categoria || 'Categoria non indicata'),
    atleta: isB2C ? '—' : (t.soc.soc_atleta || 'Atleta non indicato'),
    gruppo: isB2C ? cfg.etichettaB2C : socNome,
    tags: o.tags, prevista: t.prevista, previsteGrezze: t.previsteGrezze,
    tagAlert: t.tagAlert, tagProblema: t.tagProblema, tagRientro: t.tagRientro,
    spedizioni, multiSped: guida.length > 1,
    tracking: principale?.tracking ?? null, corriere: principale?.corriere ?? null,
    trackingUrl: principale?.trackingUrl ?? null,
    snapshotPresente: Boolean(snapSalvato),
    snapshotSorgente: snapSalvato?.sorgente ?? null,
    snapshotAggiornatoIl: snapSalvato?.aggiornatoIl ?? null,
    stato, statoReale, faseRitiro, fase, esito, attivo,
    ultimoEventoAt: principale?.ultimoEventoAt ?? null,
    ultimoEventoMessaggio: principale?.ultimoEventoMessaggio ?? null,
    ultimoEventoLuogo: principale?.ultimoEventoLuogo ?? null,
    oreUltimoEvento,
    trackAt, presaAt,
    presaApprossimata: Boolean(principale?.presaApprossimata),
    presaAtUltima,
    consegnaUltima,
    oreAttesaRitiro,
    zona, etaMin, etaMax, ritardoGG, inScadenza,
    alertDati, gravitaDati,
    alertMagazzino, gravitaMagazzino, alertSpedizione, gravitaSpedizione,
    anomalia: Boolean(eventiAnomali || alertSpedizione.length || alertMagazzino.length),
    ticket, ticketDaAprire: ticketVerso && ticket?.stato === 'ticket_da_aprire', ticketAperto,
    ricerca: [o.name, cliente, ...spedizioni.map(s => s.tracking ?? ''), socNome,
              t.soc.soc_categoria ?? '', t.soc.soc_atleta ?? '',
              dest.citta, dest.provincia, dest.regione, principale?.corriere ?? '']
             .join(' ').toLowerCase()
  };
}
