/**
 * Verifica del dominio. Copre le regole che, se si rompono in silenzio,
 * fanno prendere decisioni sbagliate agli operatori.
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_DEFAULT } from '../lib/config.ts';
import { classifica, risolviNomiSocieta, ShopifyOrdine } from '../lib/classify.ts';
import { giorniLavorativiInteri, addGiorniLavorativi, ymd } from '../lib/dates.ts';
import * as store from '../lib/store.ts';
import { queryPerimetro, queryRitiri, queryRimborsati, haSpedizioneTracciata } from '../lib/store.ts';
import { provaUscitaMagazzino, statoDaEvento } from '../lib/status.ts';
import { leggiTag } from '../lib/tags.ts';
import { CAUSE_DATI, CAUSE_MAGAZZINO } from '../lib/alerts.ts';

const F = CONFIG_DEFAULT.festivi;

/* ---------- date e giorni lavorativi ---------- */
test('i giorni lavorativi saltano il fine settimana', () => {
  // venerdì 3 luglio 2026 -> lunedì 6 luglio 2026
  assert.equal(giorniLavorativiInteri('2026-07-03T10:00:00+02:00', '2026-07-06T10:00:00+02:00', F), 1);
});

test('i giorni lavorativi saltano le festività configurate', () => {
  // 14 agosto (ven) -> 17 agosto (lun): il 15 è festivo e cade di sabato
  assert.equal(giorniLavorativiInteri('2026-08-14T09:00:00+02:00', '2026-08-17T09:00:00+02:00', F), 1);
});

test('ricevuto e ritirato lo stesso giorno vale zero giorni lavorativi', () => {
  assert.equal(giorniLavorativiInteri('2026-07-01T09:00:00+02:00', '2026-07-01T18:00:00+02:00', F), 0);
});

/* ---------- regola terminale ---------- */
test('la query operativa esclude alla sorgente gli ordini consegnati', () => {
  const q = queryPerimetro(CONFIG_DEFAULT.dataInizio);
  assert.match(q, /tag_not:consegnato/, 'il filtro deve stare nella query, non nell\'app');
  assert.match(q, /NOT status:cancelled/);
  assert.match(q, /created_at:>=2026-07-24/, 'day 1 è una data fissa, non una finestra mobile');
});

/* ---------- ritiro in negozio ---------- */
test('la query operativa esclude alla sorgente il ritiro in negozio', () => {
  const q = queryPerimetro(CONFIG_DEFAULT.dataInizio);
  assert.match(q, /NOT delivery_method:pick-up/,
    'il ritiro non e\u2019 una spedizione: va escluso dalla query, non filtrato nell\u2019app');
});

test('la query di recupero cerca SOLO i ritiri, con lo stesso perimetro', () => {
  const q = queryRitiri(CONFIG_DEFAULT.dataInizio);
  assert.match(q, /AND delivery_method:pick-up/);
  assert.doesNotMatch(q, /NOT delivery_method/, 'sarebbe la query complementare, non quella di recupero');
  assert.match(q, /tag_not:consegnato/);
  assert.match(q, /NOT status:cancelled/);
  assert.match(q, /created_at:>=2026-07-24/);
});

test('un ritiro senza spedizione tracciata resta fuori dal perimetro', () => {
  const senzaNulla = ordine({ ritiroInNegozio: true, fulfillments: [] });
  assert.equal(haSpedizioneTracciata(senzaNulla), false);

  const consegnaAMano = ordine({ ritiroInNegozio: true, fulfillments: [
    { id: 'f1', createdAt: '2026-08-28T12:00:00+02:00', status: 'SUCCESS', displayStatus: null,
      trackingInfo: [], events: { nodes: [] } } as any
  ]});
  assert.equal(haSpedizioneTracciata(consegnaAMano), false,
    'merce consegnata allo sportello: nessuna spedizione da monitorare');
});

test('un ritiro che e\u2019 stato spedito davvero rientra e viene segnalato', () => {
  const grezzo = ordine({
    ritiroInNegozio: true,
    tags: ['spedizione_prevista=2026-09-02'],
    fulfillments: [fulfillment('f1', '3UW1JS2030781', [
      evento('CARRIER_PICKED_UP', '2026-08-29T17:00:00+02:00', 'Ritirata')
    ])]
  });
  assert.equal(haSpedizioneTracciata(grezzo), true);
  const o = classifica(grezzo, CONFIG_DEFAULT, ORA);
  assert.equal(o.ritiroInNegozio, true, 'l\u2019interfaccia deve poterlo dire all\u2019operatore');
  assert.equal(o.fase, 'da_monitorare');
  assert.equal(o.tracking, '3UW1JS2030781');
});

test('una spedizione annullata non fa rientrare un ritiro nel perimetro', () => {
  const grezzo = ordine({ ritiroInNegozio: true, fulfillments: [
    { id: 'f1', createdAt: '2026-08-28T12:00:00+02:00', status: 'CANCELLED', displayStatus: 'CANCELED',
      trackingInfo: [{ number: '3UW1JS2016837', company: 'Poste Italiane', url: null }],
      events: { nodes: [] } } as any
  ]});
  assert.equal(haSpedizioneTracciata(grezzo), false,
    'la LDV annullata non e\u2019 merce che viaggia');
});

test('il ritiro si marca SOLO dalla query di recupero, mai da fulfillmentOrders', () => {
  // Leggere `fulfillmentOrders` richiede uno scope che questa app non ha: in
  // produzione rompeva l'INTERA scheda di dettaglio con "Admin API: Access denied
  // for fulfillmentOrders field". Il flag arriva da store.ts, che sa da quale
  // query proviene l'ordine. Questo test esiste per impedirne il ritorno.
  const marcato = classifica(ordine({
    ritiroInNegozio: true,
    tags: ['spedizione_prevista=2026-09-02'],
    fulfillments: [fulfillment('f1', 'AAA', [evento('IN_TRANSIT', '2026-08-29T17:00:00+02:00', 'In transito')])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(marcato.ritiroInNegozio, true);

  const normale = classifica(ordine({ tags: ['spedizione_prevista=2026-09-02'] }), CONFIG_DEFAULT, ORA);
  assert.equal(normale.ritiroInNegozio, false);
});

/* ---------- gerarchia societa ---------- */
test('lo stesso codice societa non produce due gruppi quando manca soc_nome', () => {
  // Caso reale del 01/09: 210 ordini con soc_nome, 21 senza, stesso codice_soc.
  const conNome = (n: number) => Array.from({ length: n }, () => classifica(ordine({
    tags: ['codice_soc=SPORTINGC2627', 'soc_nome=SPORTING CASTELLANA',
           'soc_categoria=PULCINI 2017', 'soc_atleta=Enea', 'spedizione_prevista=2026-09-02']
  }), CONFIG_DEFAULT, ORA));
  const senzaNome = classifica(ordine({
    tags: ['codice_soc=SPORTINGC2627', 'soc_categoria=PULCINI 2017',
           'soc_atleta=Nicola', 'spedizione_prevista=2026-09-02']
  }), CONFIG_DEFAULT, ORA);

  assert.equal(senzaNome.gruppo, 'SPORTINGC2627', 'senza risoluzione ripiega sul codice');

  const risolti = risolviNomiSocieta([...conNome(3), senzaNome]);
  assert.equal(new Set(risolti.map(x => x.gruppo)).size, 1, 'un solo gruppo per un solo codice');
  assert.equal(risolti[3].gruppo, 'SPORTING CASTELLANA');
  assert.equal(risolti[3].socNome, 'SPORTING CASTELLANA');
});

test('risolvere il nome NON cancella l\u2019alert sul tag mancante', () => {
  const conNome = classifica(ordine({
    tags: ['codice_soc=VLB', 'soc_nome=ASD Volley Brescia',
           'soc_categoria=Under 16', 'soc_atleta=Ada', 'spedizione_prevista=2026-09-02']
  }), CONFIG_DEFAULT, ORA);
  const senzaNome = classifica(ordine({
    tags: ['codice_soc=VLB', 'soc_categoria=Under 16', 'soc_atleta=Bea', 'spedizione_prevista=2026-09-02']
  }), CONFIG_DEFAULT, ORA);
  const [, risolto] = risolviNomiSocieta([conNome, senzaNome]);
  assert.equal(risolto.gruppo, 'ASD Volley Brescia');
  assert.equal(risolto.socCompleta, false, 'il tag manca davvero: va corretto a monte');
  assert.ok(risolto.alertDati.includes('soc_incompleta'),
    'la vista si aggiusta, la segnalazione resta');
});

test('il B2C non viene mai assorbito da una societa', () => {
  const soc = classifica(ordine({
    tags: ['codice_soc=VLB', 'soc_nome=ASD Volley Brescia', 'soc_categoria=U16',
           'soc_atleta=Ada', 'spedizione_prevista=2026-09-02']
  }), CONFIG_DEFAULT, ORA);
  const b2c = classifica(ordine({ tags: ['spedizione_prevista=2026-09-02'] }), CONFIG_DEFAULT, ORA);
  const [, r] = risolviNomiSocieta([soc, b2c]);
  assert.equal(r.isB2C, true);
  assert.equal(r.gruppo, 'B2C');
});

test('codici diversi restano gruppi diversi', () => {
  const a = classifica(ordine({ tags: ['codice_soc=AAA', 'soc_nome=Alfa', 'soc_categoria=U16', 'soc_atleta=X', 'spedizione_prevista=2026-09-02'] }), CONFIG_DEFAULT, ORA);
  const b = classifica(ordine({ tags: ['codice_soc=BBB', 'soc_categoria=U16', 'soc_atleta=Y', 'spedizione_prevista=2026-09-02'] }), CONFIG_DEFAULT, ORA);
  const r = risolviNomiSocieta([a, b]);
  assert.equal(r[0].gruppo, 'Alfa');
  assert.equal(r[1].gruppo, 'BBB', 'nessun nome noto per BBB: non si inventa nulla');
});

/* ---------- convenzione dei tag applicativi ---------- */
test('i tag scritti da checkpoint-tracking vengono riconosciuti', () => {
  // checkpoint-tracking scrive con l'underscore. Prima questo file cercava il
  // trattino: tagProblema e tagRientro erano sempre falsi in produzione.
  const t = leggiTag(['spedizione_problema', 'reso_in_rientro', 'consegnato', 'alert']);
  assert.equal(t.tagProblema, true);
  assert.equal(t.tagRientro, true);
  assert.equal(t.tagConsegnato, true);
  assert.equal(t.tagAlert, true);
  assert.deepEqual(t.altri, [], 'nessuno di questi deve finire fra i tag non riconosciuti');
});

test('la vecchia forma col trattino resta accettata', () => {
  const t = leggiTag(['spedizione-problema', 'reso-in-rientro']);
  assert.equal(t.tagProblema, true);
  assert.equal(t.tagRientro, true);
});

test('il rientro al mittente arriva fino allo stato e all\u2019alert', () => {
  const o = classifica(ordine({
    tags: ['reso_in_rientro', 'spedizione_prevista=2026-08-26'],
    fulfillments: [fulfillment('f1', 'A', [
      evento('CARRIER_PICKED_UP', '2026-08-28T17:00:00+02:00', 'Ritirata'),
      evento('IN_TRANSIT', '2026-08-29T09:00:00+02:00', 'In transito')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.stato, 'rientro_mittente');
  assert.ok(o.alertSpedizione.some(a => a.causa === 'rientro_mittente'));
});

/* ---------- merce ferma nel NOSTRO magazzino (famiglia `alertMagazzino`) ----------
   Dal 02/09 queste cause NON stanno piu' in `alertSpedizione`: il corriere non ha la
   merce, quindi non e' un'anomalia del vettore e non genera ticket. Si lavora in
   "Da spedire". Regola Checkpoint: *"se l'ordine deve ancora partire dal nostro
   magazzino non ha senso che sia in nessuno di quei due"*. */
const senzaEventi = (id: string, tracking: string, createdAt: string) =>
  ({ id, createdAt, status: 'SUCCESS', displayStatus: 'FULFILLED',
     trackingInfo: [{ number: tracking, company: 'Poste Italiane', url: null }],
     events: { nodes: [] } });

test('LDV senza alcun evento da 25 giorni: collo non partito, gravita critica', () => {
  // 26CKPT2423 sui dati reali: LDV del 06/08, Poste, zero eventi, merce ferma in magazzino
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    tags: ['codice_soc=SPORTINGC2627'],
    fulfillments: [senzaEventi('f1', '3UW1JS2036837', '2026-08-06T14:30:50Z') as any]
  }), CONFIG_DEFAULT, ORA);
  const c = o.alertMagazzino.find(a => a.causa === 'collo_non_partito');
  assert.ok(c, 'il caso deve avere una causa propria, non essere confuso col corriere');
  assert.equal(c!.gravita, 'critico', 'oltre 7 giorni fermo e\u2019 la cosa piu\u2019 grave del cruscotto');
  assert.equal(o.gravitaMagazzino, 'critico');
  assert.deepEqual(o.alertSpedizione, [],
    'il corriere non ha il collo: fuori da «Alert spedizione»');
});

test('collo non partito ed eventi assenti non generano piu\u2019 i due alert sovrapposti', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [senzaEventi('f1', 'AAA', '2026-08-06T14:30:50Z') as any]
  }), CONFIG_DEFAULT, ORA);
  const cause = o.alertMagazzino.map(a => a.causa);
  assert.ok(cause.includes('collo_non_partito'));
  assert.ok(!cause.includes('mancata_presa'), 'il corriere non ha mai avuto il collo: non e\u2019 mancata presa');
  assert.ok(!cause.includes('nessun_evento'), 'sarebbe lo stesso fatto detto due volte');
});

test('la gravita del collo non partito cresce con i giorni', () => {
  const caso = (ldv: string) => {
    const o = classifica(ordine({
      displayFulfillmentStatus: 'FULFILLED',
      fulfillments: [senzaEventi('f1', 'AAA', ldv) as any]
    }), CONFIG_DEFAULT, ORA);
    return o.alertMagazzino.find(a => a.causa === 'collo_non_partito')?.gravita ?? null;
  };
  assert.equal(caso('2026-08-31T08:00:00Z'), null,  'poche ore: nessun allarme, e\u2019 normale');
  assert.equal(caso('2026-08-29T08:00:00Z'), 'attenzione');
  assert.equal(caso('2026-08-26T08:00:00Z'), 'urgente');
  assert.equal(caso('2026-08-06T08:00:00Z'), 'critico');
});

test('con eventi presenti ma nessuna prova di uscita resta la mancata presa in carico', () => {
  // il corriere HA acquisito la LDV (CONFIRMED) ma non e\u2019 passato: azione diversa
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [fulfillment('f1', 'AAA', [
      evento('CONFIRMED', '2026-08-27T14:02:00+02:00', 'Spedizione confermata')
    ], '2026-08-27T13:00:00+02:00')]
  }), CONFIG_DEFAULT, ORA);
  const cause = o.alertMagazzino.map(a => a.causa);
  assert.ok(cause.includes('mancata_presa'), 'qui il sollecito al corriere ha senso');
  assert.ok(!cause.includes('collo_non_partito'), 'il collo risulta acquisito, non fermo da noi');
  assert.deepEqual(o.alertSpedizione, [], 'la merce non e\u2019 ancora uscita: non e\u2019 un alert di spedizione');
});

test('un collo non partito non propone alcun ticket, nemmeno un segnaposto', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [senzaEventi('f1', 'AAA', '2026-08-06T14:30:50Z') as any]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.gravitaMagazzino, 'critico');
  assert.equal(o.ticket, null,
    'il corriere non ha mai avuto il collo: nel registro ticket non ci deve stare per niente');
  assert.equal(o.ticketDaAprire, false);
  assert.equal(o.ticketAperto, false);
});

test('un problema vero del corriere continua a proporre il ticket', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [fulfillment('f1', 'AAA', [
      evento('CARRIER_PICKED_UP', '2026-08-24T17:00:00+02:00', 'Ritirata'),
      evento('DELAYED', '2026-08-25T09:00:00+02:00', 'Merce in giacenza presso la filiale')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.ok(o.alertSpedizione.some(a => a.causa === 'giacenza'));
  assert.equal(o.ticketDaAprire, true);
});

test('il perimetro comincia al day 1 e prima non esiste niente', () => {
  const q = queryPerimetro(CONFIG_DEFAULT.dataInizio);
  assert.match(q, /created_at:>=2026-07-24/);
  // Decisione Checkpoint: gli ordini precedenti non interessano. Nessun conteggio,
  // nessun avviso, nessuna query che li vada a cercare.
  assert.equal(typeof (store as Record<string, unknown>).contaFuoriPerimetro, 'undefined',
    'il presidio fuori perimetro non deve tornare');
});

/* ---------- si lavora per tracking ---------- */
const senzaCodice = (id: string, createdAt: string, stato = 'SUCCESS') =>
  ({ id, createdAt, status: stato, displayStatus: 'FULFILLED',
     trackingInfo: [], events: { nodes: [] } });

test('un riassortimento senza codice non nasconde la spedizione tracciata', () => {
  // 26CKPT2839 sui dati reali: il fulfillment SENZA codice e' creato DOPO
  // (20/08) ma Shopify lo restituisce per primo. Prima di questa correzione
  // l'ordine risultava "Senza tracking" e 3UW1JS2038106 non compariva.
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    tags: ['spedizione_prevista=2026-08-31'],
    fulfillments: [
      senzaCodice('f-riassortimento', '2026-08-20T12:20:56Z') as any,
      fulfillment('f-tracciata', '3UW1JS2038106', [
        evento('CONFIRMED', '2026-08-27T16:02:12+02:00', 'Spedizione confermata')
      ], '2026-08-18T10:56:44Z')
    ]
  }), CONFIG_DEFAULT, ORA);

  assert.equal(o.tracking, '3UW1JS2038106', 'il codice deve comparire, non sparire');
  assert.notEqual(o.stato, 'senza_tracking');
  assert.equal(o.corriere, 'BRT');
});

test('la merce ferma da noi resta segnalata anche con la spedizione giusta in evidenza', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [
      senzaCodice('f1', '2026-08-20T12:20:56Z') as any,
      fulfillment('f2', '3UW1JS2038106', [
        evento('CONFIRMED', '2026-08-27T16:02:12+02:00', 'Spedizione confermata')
      ], '2026-08-18T10:56:44Z')
    ]
  }), CONFIG_DEFAULT, ORA);
  // LDV acquisita dal corriere ma mai ritirata: e' mancata presa, non collo non partito
  assert.ok(o.alertMagazzino.some(a => a.causa === 'mancata_presa'),
    'il corriere ha la LDV e non e\u2019 passato: va sollecitato');
  assert.equal(o.faseRitiro, 'in_attesa_ritiro');
});

test('una spedizione annullata non governa lo stato dell\u2019ordine', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [
      { id: 'fx', createdAt: '2026-08-28T10:00:00Z', status: 'CANCELLED', displayStatus: 'CANCELED',
        trackingInfo: [{ number: 'ANNULLATA', company: 'Poste Italiane', url: null }],
        events: { nodes: [] } } as any,
      fulfillment('fok', 'BUONA', [
        evento('CARRIER_PICKED_UP', '2026-08-29T17:00:00+02:00', 'Ritirata'),
        evento('DELIVERED', '2026-08-31T10:00:00+02:00', 'Consegnata')
      ])
    ]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.tracking, 'BUONA');
  assert.equal(o.fase, 'consegnato', 'la LDV annullata non deve tenere aperto l\u2019ordine');
});

test('se NESSUNA spedizione ha un codice, si ricade su quelle che ci sono', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [senzaCodice('f1', '2026-08-20T12:20:56Z') as any]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.stato, 'senza_tracking');
  assert.equal(o.tracking, null);
});

test('addGiorniLavorativi non atterra mai su un giorno non lavorativo', () => {
  const d = addGiorniLavorativi('2026-12-24T10:00:00+01:00', 1, F);
  assert.notEqual(ymd(d), '2026-12-25');
  assert.notEqual(ymd(d), '2026-12-26');
});

/* ---------- uscita dal magazzino ---------- */
test('la creazione della LDV non è una presa in carico', () => {
  assert.equal(provaUscitaMagazzino('LABEL_PURCHASED'), false);
  assert.equal(provaUscitaMagazzino('LABEL_PRINTED'), false);
  assert.equal(provaUscitaMagazzino('CONFIRMED'), false);
  assert.equal(provaUscitaMagazzino('DELAYED'), false, 'DELAYED può precedere il ritiro');
  assert.equal(provaUscitaMagazzino('CARRIER_PICKED_UP'), true);
  assert.equal(provaUscitaMagazzino('IN_TRANSIT'), true);
});

test('il testo del corriere raffina lo stato senza contraddire Shopify', () => {
  assert.equal(statoDaEvento('DELAYED', 'Merce in giacenza presso la filiale'), 'giacenza');
  assert.equal(statoDaEvento('FAILURE', 'Indirizzo errato o incompleto'), 'indirizzo_errato');
  assert.equal(statoDaEvento('DELAYED', 'Ritardo per cause operative'), 'ferma');
  assert.equal(statoDaEvento('DELIVERED', 'Consegnata'), 'consegnata');
  assert.equal(statoDaEvento('COSA_STRANA', null), 'sconosciuto');
});

/* ---------- tag ---------- */
test('con più tag spedizione_prevista validi vince la data più lontana', () => {
  const t = leggiTag(['spedizione_prevista=2026-09-01', 'spedizione_prevista=2026-09-04']);
  assert.equal(t.prevista, '2026-09-04');
  assert.equal(t.previsteGrezze.length, 2);
});

test('un tag data in formato sbagliato non diventa una data valida', () => {
  const t = leggiTag(['spedizione_prevista=31-08-2026']);
  assert.equal(t.prevista, null);
  assert.equal(t.previsteValide.length, 0);
  assert.equal(t.previsteGrezze.length, 1);
});

/* ---------- classificazione ---------- */
const ORA = new Date('2026-08-31T10:30:00+02:00');

function ordine(p: Partial<ShopifyOrdine> = {}): ShopifyOrdine {
  return {
    id: 'gid://shopify/Order/1', name: '26CKPT9001',
    createdAt: '2026-08-28T09:00:00+02:00', updatedAt: '2026-08-30T09:00:00+02:00',
    cancelledAt: null, tags: [], note: null,
    displayFulfillmentStatus: 'UNFULFILLED', displayFinancialStatus: 'PAID',
    currentSubtotalLineItemsQuantity: 3,
    customer: { displayName: 'Mario Rossi' },
    shippingAddress: { name: 'Mario Rossi', city: 'Brescia', province: 'Lombardia',
      provinceCode: 'BS', country: 'Italy', countryCodeV2: 'IT', zip: '25100' },
    fulfillments: [], ...p
  } as ShopifyOrdine;
}
const evento = (status: string, happenedAt: string, message = '') =>
  ({ id: 'e' + happenedAt, status, happenedAt, message });
const fulfillment = (id: string, tracking: string, eventi: any[], createdAt = '2026-08-28T12:00:00+02:00') =>
  ({ id, createdAt, status: 'SUCCESS', displayStatus: null,
     trackingInfo: [{ number: tracking, company: 'BRT', url: null }], events: { nodes: eventi } });

test('senza tag società l’ordine è B2C e non genera alert per questo', () => {
  const o = classifica(ordine({ tags: ['spedizione_prevista=2026-09-02'] }), CONFIG_DEFAULT, ORA);
  assert.equal(o.isB2C, true);
  assert.equal(o.gruppo, 'B2C');
  assert.deepEqual(o.alertDati, []);
});

test('tag società parziali NON diventano B2C ma segnalano dati incompleti', () => {
  const o = classifica(ordine({
    tags: ['soc_nome=ASD Volley Brescia', 'soc_categoria=Under 16', 'spedizione_prevista=2026-09-02']
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.isB2C, false);
  assert.equal(o.socNome, 'ASD Volley Brescia');
  assert.equal(o.atleta, 'Atleta non indicato');
  assert.ok(o.alertDati.includes('soc_incompleta'));
});

test('l’assenza del tag data fa comparire l’alert anche senza il tag alert', () => {
  const o = classifica(ordine({ tags: ['codice_soc=VLB'] }), CONFIG_DEFAULT, ORA);
  assert.equal(o.tagAlert, false);
  assert.ok(o.alertDati.includes('data_mancante'));
});

test('tag data duplicati generano il conflitto', () => {
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-09-01', 'spedizione_prevista=2026-09-04']
  }), CONFIG_DEFAULT, ORA);
  assert.ok(o.alertDati.includes('tag_conflitto'));
});

test('etichetta creata ma nessun ritiro: l’ordine resta Da spedire', () => {
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-31'],
    fulfillments: [fulfillment('f1', '0281734590021', [
      evento('LABEL_PURCHASED', '2026-08-28T12:00:00+02:00', 'Etichetta creata')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.fase, 'da_spedire');
  assert.equal(o.faseRitiro, 'in_attesa_ritiro');
  assert.equal(o.presaAt, null);
  assert.equal(o.etaMax, null, 'senza presa in carico non esiste finestra di consegna');
  assert.ok((o.oreAttesaRitiro ?? 0) > 24, 'sono le ore su cui si decide se sollecitare');
});

test('la presa in carico sposta l’ordine su Da monitorare', () => {
  const o = classifica(ordine({
    tags: ['codice_soc=VLB', 'soc_nome=ASD Volley Brescia', 'soc_categoria=Under 16', 'soc_atleta=Rossi Mario',
           'spedizione_prevista=2026-08-28'],
    fulfillments: [fulfillment('f1', '0281734590021', [
      evento('LABEL_PURCHASED', '2026-08-28T12:00:00+02:00', 'Etichetta creata'),
      evento('CARRIER_PICKED_UP', '2026-08-28T17:30:00+02:00', 'Ritirata dal corriere'),
      evento('IN_TRANSIT', '2026-08-31T06:00:00+02:00', 'In transito')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.fase, 'da_monitorare');
  assert.equal(o.presaAt, '2026-08-28T17:30:00+02:00');
  assert.equal(o.oreAttesaRitiro, null, 'a ritiro avvenuto non si attende più nulla');
  assert.ok(o.etaMax, 'la finestra di consegna parte dalla presa in carico');
});

test('la Sicilia usa la finestra 2–3 giorni lavorativi, non quella standard', () => {
  const base = {
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [fulfillment('f1', 'X1', [
      evento('CARRIER_PICKED_UP', '2026-08-24T17:00:00+02:00', 'Ritirata')
    ])]
  };
  const nord = classifica(ordine(base), CONFIG_DEFAULT, ORA);
  const sud = classifica(ordine({
    ...base,
    shippingAddress: { name: 'x', city: 'Palermo', province: 'Sicilia', provinceCode: 'PA',
      country: 'Italy', countryCodeV2: 'IT', zip: '90100' }
  }), CONFIG_DEFAULT, ORA);
  assert.equal(nord.zona, 'IT_STANDARD');
  assert.equal(sud.zona, 'IT_SICILIA');
  assert.ok(new Date(sud.etaMax!) > new Date(nord.etaMax!), 'la finestra siciliana deve essere più lunga');
});

test('ordine con due spedizioni: consegnato solo quando lo sono entrambe', () => {
  const parziale = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [
      fulfillment('f1', 'A', [evento('CARRIER_PICKED_UP', '2026-08-24T17:00:00+02:00', 'Ritirata'),
                              evento('DELIVERED', '2026-08-26T10:00:00+02:00', 'Consegnata')]),
      fulfillment('f2', 'B', [evento('CARRIER_PICKED_UP', '2026-08-27T17:00:00+02:00', 'Ritirata')])
    ]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(parziale.multiSped, true);
  assert.equal(parziale.fase, 'da_monitorare', 'una consegna parziale non archivia l’ordine');
  assert.equal(parziale.consegnaUltima, null);
  /* I tempi seguono la spedizione GUIDA, cioe' la prima non consegnata: qui la 'B',
     ritirata il 27. Prima si prendeva il ritiro piu' vecchio (24, quello della merce
     gia' arrivata) e la finestra di consegna veniva calcolata su un collo che non era
     piu' in viaggio. Vedi 26CKPT2620. */
  assert.equal(parziale.presaAt, '2026-08-27T17:00:00+02:00');
  assert.equal(parziale.presaAtUltima, '2026-08-27T17:00:00+02:00',
    'informativo: tutte le spedizioni sono uscite dal magazzino');

  const completo = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [
      fulfillment('f1', 'A', [evento('CARRIER_PICKED_UP', '2026-08-24T17:00:00+02:00', 'Ritirata'),
                              evento('DELIVERED', '2026-08-26T10:00:00+02:00', 'Consegnata')]),
      fulfillment('f2', 'B', [evento('CARRIER_PICKED_UP', '2026-08-27T17:00:00+02:00', 'Ritirata'),
                              evento('DELIVERED', '2026-08-28T11:00:00+02:00', 'Consegnata')])
    ]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(completo.fase, 'consegnato');
  assert.equal(completo.esito, 'consegnato');
  assert.equal(completo.consegnaUltima, '2026-08-28T11:00:00+02:00');
});

test('un ordine annullato esce dalle viste operative e non genera alert', () => {
  const o = classifica(ordine({ cancelledAt: '2026-08-29T10:00:00+02:00', tags: [] }), CONFIG_DEFAULT, ORA);
  assert.equal(o.esito, 'annullato');
  assert.equal(o.fase, 'chiuso');
  assert.equal(o.attivo, false);
  assert.deepEqual(o.alertDati, []);
  assert.deepEqual(o.alertSpedizione, []);
});

test('tracking fermo oltre soglia: stato non aggiornato e alert di spedizione', () => {
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-20'],
    fulfillments: [fulfillment('f1', 'C', [
      evento('CARRIER_PICKED_UP', '2026-08-20T17:00:00+02:00', 'Ritirata'),
      evento('IN_TRANSIT', '2026-08-21T08:00:00+02:00', 'In transito')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.stato, 'non_aggiornato');
  assert.equal(o.statoReale, 'in_transito');
  const cause = o.alertSpedizione.map(a => a.causa);
  assert.ok(cause.includes('tracking_fermo'));
  assert.ok(cause.includes('oltre_finestra'));
  assert.ok(cause.includes('smarrimento'), 'oltre 7 giorni fermo è un possibile smarrimento');
  assert.equal(o.ticket?.stato, 'ticket_da_aprire');
});

test('il tag alert sorgente e l’alert applicativo restano distinguibili', () => {
  const o = classifica(ordine({ tags: ['alert', 'spedizione_prevista=2026-09-02'] }), CONFIG_DEFAULT, ORA);
  assert.equal(o.tagAlert, true);
  assert.deepEqual(o.alertDati, ['tag_alert']);
});

test('in un ordine con due spedizioni, quella consegnata non guida più lo stato', () => {
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [
      // prima spedizione: consegnata e chiusa
      fulfillment('f1', 'A', [evento('CARRIER_PICKED_UP', '2026-08-24T17:00:00+02:00', 'Ritirata'),
                              evento('DELIVERED', '2026-08-26T10:00:00+02:00', 'Consegnata')]),
      // seconda: ancora in giacenza, è questa a dover comparire negli alert
      fulfillment('f2', 'B', [evento('CARRIER_PICKED_UP', '2026-08-27T17:00:00+02:00', 'Ritirata'),
                              evento('DELAYED', '2026-08-28T09:00:00+02:00', 'Merce in giacenza presso la filiale')])
    ]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.fase, 'da_monitorare');
  // lo stato è quello della SECONDA spedizione, non della prima già consegnata.
  // Una giacenza resta "giacenza" anche se ferma da giorni: è più azionabile di
  // "tracking non aggiornato", che vale solo per gli stati di transito.
  assert.equal(o.stato, 'giacenza');
  assert.ok(o.alertSpedizione.some(a => a.causa === 'giacenza'),
    'gli alert seguono la spedizione ancora attiva, non quella già consegnata');
});

/* ---------- in "Dati da sistemare" solo errori veri (02/09) ---------- */
test('data prevista superata e nessuna LDV: NESSUN alert sui dati', () => {
  // prima uscivano `data_passata` E `tracking_mancante`: nessuno dei due e' un errore
  const o = classifica(ordine({ tags: ['spedizione_prevista=2026-08-20'] }), CONFIG_DEFAULT, ORA);
  assert.equal(o.fase, 'da_spedire');
  assert.equal(o.tracking, null);
  assert.deepEqual(o.alertDati, [],
    'un ritardo non e’ un dato da correggere: si vede in Da spedire, blocco In ritardo');
});

test('le cause tracking_mancante e data_passata non esistono piu’ nella tassonomia', () => {
  const cause = Object.keys(CAUSE_DATI);
  assert.ok(!cause.includes('tracking_mancante'),
    'reintrodurla riempirebbe la vista Dati di righe su cui nessuno deve agire');
  assert.ok(!cause.includes('data_passata'),
    'sforare una data e’ un ritardo, non un errore: correggere il tag sarebbe lavoro inventato');
});

test('il tag data mancante o scritto male resta un errore vero', () => {
  const senza = classifica(ordine({ tags: [] }), CONFIG_DEFAULT, ORA);
  assert.deepEqual(senza.alertDati, ['data_mancante']);
  const rotto = classifica(ordine({ tags: ['spedizione_prevista=20/08/2026'] }), CONFIG_DEFAULT, ORA);
  assert.deepEqual(rotto.alertDati, ['data_non_valida']);
});

/* ---------- niente ticket senza una spedizione che il corriere abbia davvero ---------- */
test('un ordine senza tracking non propone alcun ticket al corriere', () => {
  const o = classifica(ordine({ tags: ['spedizione_prevista=2026-08-10'] }), CONFIG_DEFAULT, ORA);
  assert.deepEqual(o.alertSpedizione, []);
  assert.equal(o.ticket, null);
  assert.equal(o.ticketDaAprire, false);
  assert.equal(o.ticketAperto, false);
});

test('un ticket salvato su un ordine senza tracking resta fuori dal registro', () => {
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-10'],
    ticket: { value: JSON.stringify({ stato: 'ticket_aperto', apertoIl: null, operatore: null,
      corriere: null, riferimento: null, note: null, aggiornatoIl: null,
      prossimoControllo: null, esito: null }), updatedAt: '2026-08-30T09:00:00+02:00' }
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.ticket?.stato, 'ticket_aperto', 'il dato salvato resta leggibile nel dettaglio');
  assert.equal(o.ticketAperto, false, 'ma non conta come ticket verso il corriere');
  assert.equal(o.ticketDaAprire, false);
});

test('con una spedizione tracciata il ticket continua a proporsi', () => {
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-20'],
    fulfillments: [fulfillment('f1', 'Z9', [
      evento('CARRIER_PICKED_UP', '2026-08-20T17:00:00+02:00', 'Ritirata'),
      evento('DELAYED', '2026-08-21T09:00:00+02:00', 'Merce in giacenza presso la filiale')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.ok(o.tracking);
  assert.equal(o.ticketDaAprire, true);
});

/* ---------- rimborsati (02/09) ---------- */
test('la query operativa esclude alla sorgente gli ordini rimborsati', () => {
  const q = queryPerimetro('2026-07-24');
  assert.ok(q.includes('NOT financial_status:refunded'),
    'un ordine rimborsato non verra’ mai spedito: non deve nemmeno essere caricato');
});

test('la query di recupero cerca SOLO i rimborsati, con lo stesso perimetro', () => {
  const q = queryRimborsati('2026-07-24');
  assert.ok(q.includes('AND financial_status:refunded'));
  assert.ok(!q.includes('NOT financial_status:refunded'));
  assert.ok(q.includes('created_at:>=2026-07-24'));
  assert.ok(q.includes('tag_not:consegnato'));
  assert.ok(q.includes(`NOT ${store.FILTRO_RITIRO}`), 'il ritiro resta escluso anche qui');
});

test('rimborsato con merce presa in carico: rientra e viene segnalato come critico', () => {
  const o = classifica(ordine({
    displayFinancialStatus: 'REFUNDED',
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [fulfillment('f1', 'RB1', [
      evento('CARRIER_PICKED_UP', '2026-08-30T17:00:00+02:00', 'Ritirata'),
      evento('IN_TRANSIT', '2026-08-31T08:00:00+02:00', 'In transito')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.rimborsatoTotale, true);
  assert.equal(o.fase, 'da_monitorare', 'la merce viaggia: sopravvive al filtro di caricaOrdini');
  assert.ok(o.alertDati.includes('rimborsato_in_viaggio'));
  assert.equal(o.gravitaDati, 'critico');
});

test('rimborsato con LDV stampata ma mai ritirata: resta fuori', () => {
  const o = classifica(ordine({
    displayFinancialStatus: 'REFUNDED',
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [fulfillment('f1', 'RB2', [])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.rimborsatoTotale, true);
  assert.equal(o.fase, 'da_spedire', 'nessuna presa in carico');
  assert.ok(!o.alertDati.includes('rimborsato_in_viaggio'),
    'senza merce in viaggio non c’e’ niente da verificare: l’ordine viene scartato');
});

test('il rimborso parziale non tocca il perimetro: resta merce da spedire', () => {
  const o = classifica(ordine({
    displayFinancialStatus: 'PARTIALLY_REFUNDED',
    tags: ['spedizione_prevista=2026-09-02']
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.rimborsatoTotale, false);
  assert.equal(o.rimborsoParziale, true);
  assert.equal(o.fase, 'da_spedire');
  assert.deepEqual(o.alertDati, []);
});

/* ---------- tracking cliccabile (02/09) ---------- */
const fulfillmentConUrl = (id: string, tracking: string, url: string, eventi: any[]) =>
  ({ id, createdAt: '2026-08-28T12:00:00+02:00', status: 'SUCCESS', displayStatus: null,
     trackingInfo: [{ number: tracking, company: 'Poste Italiane', url }],
     events: { nodes: eventi } });

test('la pagina di tracking arriva da Shopify e non si costruisce a mano', () => {
  const url = 'https://www.check-point-store.it/pages/tracking-area?o=17779050447197&t=zTn0L4bUE5Ru61H8';
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [fulfillmentConUrl('f1', '3UW1JS2039041', url,
      [evento('CARRIER_PICKED_UP', '2026-08-30T17:00:00+02:00', 'Ritirata')])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.tracking, '3UW1JS2039041');
  assert.equal(o.trackingUrl, url);
  assert.equal(o.spedizioni[0].trackingUrl, url);
});

test('senza url il codice resta testo: mai un link finto', () => {
  const o = classifica(ordine({
    fulfillments: [fulfillment('f1', 'SENZAURL', [])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.tracking, 'SENZAURL');
  assert.equal(o.trackingUrl, null);
});

test('con due spedizioni il link segue quella che guida, non la consegnata', () => {
  const consegnata = fulfillmentConUrl('f1', 'AAA', 'https://esempio/consegnata',
    [evento('CARRIER_PICKED_UP', '2026-08-24T17:00:00+02:00', 'Ritirata'),
     evento('DELIVERED', '2026-08-26T10:00:00+02:00', 'Consegnata')]);
  const inViaggio = fulfillmentConUrl('f2', 'BBB', 'https://esempio/in-viaggio',
    [evento('CARRIER_PICKED_UP', '2026-08-30T17:00:00+02:00', 'Ritirata')]);
  const o = classifica(ordine({ fulfillments: [consegnata, inViaggio] }), CONFIG_DEFAULT, ORA);
  assert.equal(o.tracking, 'BBB');
  assert.equal(o.trackingUrl, 'https://esempio/in-viaggio');
});

/* ---------- il riassunto non puo’ smentire Shopify (02/09) ---------- */
test('caso 26CKPT2619: DELIVERED su Shopify, riassunto vecchio che dice di no', () => {
  /* Riproduce il caso reale: tracking corretto a mano, checkpoint-tracking riscrive il
     riassunto dal percorso `creazione` un secondo dopo l’evento DELIVERED e lo salva con
     numeroEventi 0 e consegnaAt null. Prima di questa regola l’ordine restava per sempre
     nel perimetro operativo. */
  const snapshotVecchio = JSON.stringify({
    v: 1, aggiornatoIl: '2026-09-02T09:24:35.082Z', sorgente: 'creazione',
    spedizioni: [{
      fulfillmentId: 'gid://shopify/Fulfillment/8236269896029',
      tracking: 'JJD149990200057895123', corriere: 'DHL eCommerce',
      trackAt: '2026-08-07T06:46:46Z', presaAt: null, presaStatus: null,
      presaApprossimata: false, consegnaAt: null, ultimoEventoAt: null,
      ultimoEventoStatus: null, ultimoEventoMessaggio: null, ultimoEventoLuogo: null,
      numeroEventi: 0
    }]
  });
  const o = classifica(ordine({
    tags: ['exported=1'],
    displayFulfillmentStatus: 'FULFILLED',
    snapshot: { value: snapshotVecchio, updatedAt: '2026-09-02T09:24:35Z' },
    fulfillments: [{
      id: 'gid://shopify/Fulfillment/8236269896029',
      createdAt: '2026-08-07T06:46:46Z', status: 'SUCCESS', displayStatus: 'DELIVERED',
      trackingInfo: [{ number: 'JJD149990200057895123', company: 'DHL eCommerce', url: null }]
    } as any]
  }), CONFIG_DEFAULT, ORA);

  assert.equal(o.spedizioni[0].consegnata, true, 'displayStatus DELIVERED vince sul riassunto');
  assert.equal(o.fase, 'consegnato', 'una volta consegnato deve sparire dalle viste operative');
  assert.equal(o.esito, 'consegnato');
  assert.equal(o.attivo, false);
  assert.equal(o.stato, 'consegnata', 'mai piu’ “Tracking creato” su una consegna avvenuta');
  assert.deepEqual(o.alertDati, [], 'niente alert su un ordine chiuso, nemmeno la data assente');
  assert.deepEqual(o.alertSpedizione, []);
  assert.equal(o.consegnaUltima, null, 'la data non si inventa: il riassunto non ce l’ha');
});

test('con due spedizioni serve che TUTTE risultino consegnate', () => {
  const consegnataShopify = {
    id: 'f1', createdAt: '2026-08-20T12:00:00+02:00', status: 'SUCCESS',
    displayStatus: 'DELIVERED',
    trackingInfo: [{ number: 'AAA', company: 'DHL eCommerce', url: null }]
  } as any;
  const o = classifica(ordine({
    tags: ['spedizione_prevista=2026-08-24'],
    fulfillments: [consegnataShopify, fulfillment('f2', 'BBB',
      [evento('CARRIER_PICKED_UP', '2026-08-30T17:00:00+02:00', 'Ritirata')])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.fase, 'da_monitorare');
  assert.equal(o.tracking, 'BBB', 'guida la spedizione ancora in viaggio');
});

/* ---------- il confine fra le due schermate (02/09) ---------- */
test('CAUSE_MAGAZZINO e alert di spedizione non si sovrappongono mai', () => {
  /* La regola vale per costruzione, non per caso: nessuna causa di magazzino puo’
     comparire fra gli alert del vettore, in nessuno stato dell’ordine. */
  const fermo = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [senzaEventi('f1', 'FERMO', '2026-08-06T14:30:50Z') as any]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(fermo.fase, 'da_spedire');
  assert.ok(fermo.alertMagazzino.length);
  assert.ok(fermo.alertSpedizione.every(a => !CAUSE_MAGAZZINO.includes(a.causa)));

  const inViaggio = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [fulfillment('f1', 'VIAGGIO', [
      evento('CARRIER_PICKED_UP', '2026-08-24T17:00:00+02:00', 'Ritirata'),
      evento('DELAYED', '2026-08-25T09:00:00+02:00', 'Merce in giacenza presso la filiale')
    ])]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(inViaggio.fase, 'da_monitorare');
  assert.deepEqual(inViaggio.alertMagazzino, [],
    'preso in carico dal corriere: non e’ piu’ merce ferma da noi');
  assert.ok(inViaggio.alertSpedizione.some(a => a.causa === 'giacenza'));
  assert.equal(inViaggio.ticketDaAprire, true);
});

test('un ordine che deve ancora partire non genera MAI un ticket', () => {
  const casi = [
    // LDV creata, zero eventi
    [senzaEventi('f1', 'A1', '2026-08-06T14:30:50Z') as any],
    // LDV acquisita dal corriere ma mai ritirata
    [fulfillment('f1', 'A2', [evento('CONFIRMED', '2026-08-20T14:02:00+02:00', 'Confermata')],
      '2026-08-20T13:00:00+02:00')]
  ];
  for (const fulfillments of casi) {
    const o = classifica(ordine({ displayFulfillmentStatus: 'FULFILLED', fulfillments }),
      CONFIG_DEFAULT, ORA);
    assert.equal(o.fase, 'da_spedire');
    assert.equal(o.ticket, null, 'merce ancora nostra: niente ticket al vettore');
    assert.deepEqual(o.alertSpedizione, []);
    assert.ok(o.alertMagazzino.length, 'ma la segnalazione non si perde: vive in Da spedire');
  }
});

/* ---------- ordini misti: un collo consegnato, uno ancora fermo (02/09) ---------- */
test('caso 26CKPT2620: un collo consegnato non fa credere che l’altro sia partito', () => {
  /* Dati reali: f1 con LDV dell’11/08 e ZERO eventi (mai partita dal magazzino),
     f2 consegnata il 27/08. Prima l’ordine ereditava il ritiro di f2, finiva in
     "Da monitorare" con una finestra calcolata su una data che non c’entrava, sforava,
     e produceva un alert di spedizione PIU’ un ticket al corriere — per una merce che
     il corriere non ha mai ricevuto. */
  const fermaDa22Giorni = {
    id: 'gid://shopify/Fulfillment/8256419365213', createdAt: '2026-08-11T10:02:21Z',
    status: 'SUCCESS', displayStatus: 'FULFILLED',
    trackingInfo: [{ number: '3UW1JS2037465', company: 'Poste Italiane', url: null }],
    events: { nodes: [] }
  } as any;
  const consegnata = {
    id: 'gid://shopify/Fulfillment/8236283003229', createdAt: '2026-08-07T06:51:39Z',
    status: 'SUCCESS', displayStatus: 'DELIVERED',
    trackingInfo: [{ number: '3UW1JS2037052', company: 'Poste Italiane', url: null }],
    events: { nodes: [evento('DELIVERED', '2026-08-27T12:43:25Z', '')] }
  } as any;

  // Shopify restituisce la piu' recente per prima: l'ordine dei fulfillment non conta.
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    tags: ['codice_soc=SPORTINGC2627', 'soc_nome=SPORTING CASTELLANA',
           'soc_categoria=UNDER 14/15/16/17/18', 'soc_atleta=Paolo',
           'spedizione_prevista=2026-08-21'],
    fulfillments: [fermaDa22Giorni, consegnata]
  }), CONFIG_DEFAULT, ORA);

  assert.equal(o.tracking, '3UW1JS2037465', 'guida il collo ancora da spedire');
  assert.equal(o.presaAt, null, 'il ritiro dell’altro collo non si eredita');
  assert.equal(o.fase, 'da_spedire', 'il secondo collo deve ancora partire');
  assert.equal(o.ritardoGG, 0, 'nessuna finestra di consegna: non e’ mai stato ritirato');
  assert.deepEqual(o.alertSpedizione, [], 'il corriere non ha questo collo');
  assert.equal(o.ticket, null, 'e quindi non c’e’ niente da contestargli');
  assert.ok(o.alertMagazzino.some(a => a.causa === 'collo_non_partito'),
    'ma il collo fermo da 22 giorni si vede in Da spedire, gravita’ critica');
  assert.equal(o.gravitaMagazzino, 'critico');
});

test('lo stesso ordine con il collo residuo davvero in viaggio torna da monitorare', () => {
  const inViaggio = fulfillment('f1', 'RESIDUO',
    [evento('CARRIER_PICKED_UP', '2026-08-31T09:00:00+02:00', 'Ritirata')],
    '2026-08-30T10:00:00Z');
  const consegnata = {
    id: 'f2', createdAt: '2026-08-07T06:51:39Z', status: 'SUCCESS', displayStatus: 'DELIVERED',
    trackingInfo: [{ number: 'VECCHIA', company: 'Poste Italiane', url: null }],
    events: { nodes: [evento('DELIVERED', '2026-08-27T12:43:25Z', '')] }
  } as any;
  const o = classifica(ordine({ fulfillments: [inViaggio, consegnata] }), CONFIG_DEFAULT, ORA);
  assert.equal(o.fase, 'da_monitorare');
  assert.equal(o.presaAt, '2026-08-31T09:00:00+02:00', 'la data e’ quella del collo che viaggia');
  assert.deepEqual(o.alertMagazzino, []);
});

/* ---------- displayStatus batte un riassunto fermo (07/09) ---------- */
test('caso 26CKPT2972: riassunto vecchio dice “nessun evento”, Shopify dice “in consegna”', () => {
  /* Dati reali. Il riassunto e' stato scritto dal percorso `creazione` l’1/09 con
     presaAt null e numeroEventi 0, e da allora non e’ piu’ stato aggiornato. Sullo
     stesso fulfillment Shopify dice OUT_FOR_DELIVERY. Prima l’ordine risultava “da
     spedire, collo fermo in magazzino” mentre il pacco era sul furgone. */
  const snapshotFermo = JSON.stringify({
    v: 1, aggiornatoIl: '2026-09-01T18:16:53.825Z', sorgente: 'creazione',
    spedizioni: [{
      fulfillmentId: 'gid://shopify/Fulfillment/8357143019869',
      tracking: '3UW1JS2039094', corriere: 'Poste Italiane',
      trackAt: '2026-09-01T18:16:49Z', presaAt: null, presaStatus: null,
      presaApprossimata: false, consegnaAt: null, ultimoEventoAt: null,
      ultimoEventoStatus: null, ultimoEventoMessaggio: null, ultimoEventoLuogo: null,
      numeroEventi: 0
    }]
  });
  const o = classifica(ordine({
    createdAt: '2026-08-27T10:59:36Z',
    displayFulfillmentStatus: 'FULFILLED',
    tags: ['codice_soc=SPORTINGC2627', 'soc_nome=SPORTING CASTELLANA',
           'soc_categoria=ESORDIENTI 2014', 'soc_atleta=Manuel Pascolo',
           'spedizione_prevista=2026-09-11'],
    snapshot: { value: snapshotFermo, updatedAt: '2026-09-01T18:16:53Z' },
    fulfillments: [{
      id: 'gid://shopify/Fulfillment/8357143019869', createdAt: '2026-09-01T18:16:49Z',
      status: 'SUCCESS', displayStatus: 'OUT_FOR_DELIVERY',
      trackingInfo: [{ number: '3UW1JS2039094', company: 'Poste Italiane', url: null }]
    } as any]
  }), CONFIG_DEFAULT, new Date('2026-09-07T10:00:00+02:00'));

  assert.equal(o.fase, 'da_monitorare', 'il collo si muove: non e’ piu’ roba da spedire');
  assert.equal(o.stato, 'in_consegna');
  assert.equal(o.faseRitiro, 'preso_in_carico');
  assert.deepEqual(o.alertMagazzino, [], 'non e’ un collo fermo in magazzino');
  assert.deepEqual(o.alertSpedizione, [], 'e non e’ nemmeno un problema del corriere');
  assert.equal(o.presaAt, null, 'la DATA non si inventa: il riassunto non ce l’ha');
  assert.equal(o.etaMax, null, 'senza data di ritiro non si calcola una finestra');
  assert.equal(o.ritardoGG, 0, 'e senza finestra non si puo’ essere in ritardo');
});

test('FULFILLED non e’ prova di uscita: il collo puo’ essere ancora sul bancone', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [senzaEventi('f1', 'SUL-BANCONE', '2026-08-06T14:30:50Z') as any]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.fase, 'da_spedire');
  assert.ok(o.alertMagazzino.some(a => a.causa === 'collo_non_partito'));
});

test('gli eventi del riassunto, quando ci sono, restano la fonte piu’ precisa', () => {
  const o = classifica(ordine({
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [{
      id: 'f1', createdAt: '2026-08-24T12:00:00+02:00', status: 'SUCCESS',
      displayStatus: 'IN_TRANSIT',
      trackingInfo: [{ number: 'PRECISO', company: 'Poste Italiane', url: null }],
      events: { nodes: [
        evento('CARRIER_PICKED_UP', '2026-08-30T17:00:00+02:00', 'Ritirata'),
        evento('DELAYED', '2026-08-31T08:00:00+02:00', 'Merce in giacenza presso la filiale')
      ] }
    } as any]
  }), CONFIG_DEFAULT, ORA);
  assert.equal(o.stato, 'giacenza', 'il testo del corriere raffina, displayStatus non lo copre');
  assert.equal(o.presaAt, '2026-08-30T17:00:00+02:00', 'con gli eventi la data c’e’ davvero');
  assert.ok(o.etaMax, 'e la finestra di consegna si puo’ calcolare');
});
