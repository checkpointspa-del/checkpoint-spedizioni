/**
 * Lettura degli ordini da Shopify e classificazione.
 *
 * Perimetro: SOLO ordini non consegnati. Un ordine le cui spedizioni risultano
 * tutte consegnate esce dalle viste operative e non viene più interrogato.
 * L'app non costruisce alcun archivio: gli ordini chiusi restano su Shopify.
 *
 * Cache in memoria con TTL breve: serve solo a non ripetere la stessa
 * paginazione per ogni schermata aperta nello stesso minuto. Non è persistenza,
 * e l'app resta corretta anche quando l'istanza serverless riparte a freddo.
 */
import { adminGraphQL } from './shopify';
import { Q_ORDINI_LISTA, Q_ORDINE_DETTAGLIO, Q_CONFIG, M_SET_METAFIELD } from './graphql';
import { classifica, risolviNomiSocieta, ShopifyOrdine, OrdineApp } from './classify';
import { Config, mergeConfig, METAFIELD_CONFIG } from './config';

const TTL_MS = 60_000;
const MAX_PAGINE = 12;                 // 1.200 ordini attivi: oltre, il perimetro va ristretto

interface Voce<T> { dato: T; scade: number }
const cacheOrdini = new Map<string, Voce<OrdineApp[]>>();
const cacheConfig = new Map<string, Voce<Config>>();

/**
 * Scope realmente concessi, letti insieme alla configurazione.
 *
 * Serve per una ragione sola: senza `read_all_orders` l'Admin API restituisce
 * gli ultimi 60 giorni **e non lo dice**. Un cruscotto che mostra meno ordini
 * senza dichiararlo e' peggio di uno che non parte, perche' l'operatore si fida.
 * `null` = non ancora noto (nessuna lettura fatta).
 */
const scopeConcessi = new Map<string, string[]>();

export function leggeTuttoLoStorico(shop?: string): boolean | null {
  const v = scopeConcessi.get(shop || 'default');
  return v ? v.includes('read_all_orders') : null;
}

export async function caricaConfig(shop?: string, forza = false): Promise<Config> {
  const key = shop || 'default';
  const hit = cacheConfig.get(key);
  if (!forza && hit && hit.scade > Date.now()) return hit.dato;

  const d = await adminGraphQL<{ currentAppInstallation: {
      metafield: { value: string } | null;
      accessScopes: { handle: string }[] | null;
    } }>(Q_CONFIG, {}, { shop });
  scopeConcessi.set(key, (d.currentAppInstallation?.accessScopes ?? []).map(x => x.handle));
  const grezza = d.currentAppInstallation?.metafield?.value;
  const cfg = mergeConfig(grezza ? JSON.parse(grezza) : null);
  cacheConfig.set(key, { dato: cfg, scade: Date.now() + 5 * 60_000 });
  return cfg;
}

/**
 * Perimetro operativo.
 *
 * REGOLA TERMINALE: si interrogano soltanto le spedizioni non consegnate.
 * Il filtro sta nella query, non nell'applicazione: gli ordini consegnati non
 * vengono caricati e poi scartati, non arrivano proprio.
 *
 * La leva è il tag `consegnato`, che checkpoint-tracking applica quando l'ordine
 * è interamente evaso e tutte le spedizioni attive risultano DELIVERED. Non può
 * essere il metafield del riassunto: i metafield di tipo json non sono filtrabili.
 *
 * `tag_not:` è un filtro supportato dalla query orders dell'Admin API.
 */
export const FILTRO_RITIRO = 'delivery_method:pick-up';

/**
 * Rimborsato = non verra' mai spedito.
 *
 * `financial_status:refunded` intercetta il rimborso TOTALE. I parzialmente rimborsati
 * (`partially_refunded`) non sono toccati da questo filtro ed e' corretto: hanno ancora
 * merce da spedire e restano lavoro a tutti gli effetti.
 */
export const FILTRO_RIMBORSATO = 'financial_status:refunded';

export function queryPerimetro(dataInizio: string): string {
  return `created_at:>=${dataInizio} AND NOT status:cancelled AND tag_not:consegnato`
       + ` AND NOT ${FILTRO_RITIRO} AND NOT ${FILTRO_RIMBORSATO}`;
}

/**
 * Ritiro in negozio, il recupero.
 *
 * Il ritiro non e' una spedizione: non si monitora, non genera alert, ed e' escluso
 * alla sorgente da `queryPerimetro`. Ma sui dati reali di questo store il 20% degli
 * ordini `pick-up` ha comunque una LDV tracciata: sono clienti che hanno scelto il
 * ritiro e poi si sono fatti spedire la merce. Escluderli e basta significherebbe
 * perdere spedizioni vere, che e' esattamente cio' che la regola terminale vieta.
 *
 * Quindi si rileggono i soli ordini di ritiro e si tengono quelli che una spedizione
 * tracciata ce l'hanno. La query e' la stessa delle liste: nessun percorso di codice
 * nuovo, e il costo e' una pagina che oggi torna vuota.
 */
export function queryRitiri(dataInizio: string): string {
  return `created_at:>=${dataInizio} AND NOT status:cancelled AND tag_not:consegnato`
       + ` AND ${FILTRO_RITIRO}`;
}

/**
 * Rimborsati, il recupero.
 *
 * Simmetrico a `queryRitiri`. Un ordine rimborsato non si lavora, ma se il corriere ha
 * gia' preso in carico la merce succede l'opposto di quello che dovrebbe: soldi resi e
 * collo in viaggio. Puo' essere un rientro corretto oppure un rimborso emesso per
 * errore — in entrambi i casi qualcuno deve guardarlo lo stesso giorno.
 *
 * Rientra SOLO chi e' davvero in viaggio: il filtro non e' "ha una LDV" (le etichette
 * stampate e mai ritirate restano fuori) ma la presa in carico effettiva, cioe'
 * `fase === 'da_monitorare'` dopo la classificazione. Vedi `caricaOrdini`.
 */
export function queryRimborsati(dataInizio: string): string {
  return `created_at:>=${dataInizio} AND NOT status:cancelled AND tag_not:consegnato`
       + ` AND NOT ${FILTRO_RITIRO} AND ${FILTRO_RIMBORSATO}`;
}

/** Un ordine di ritiro rientra nel perimetro solo se una spedizione tracciata esiste davvero. */
export function haSpedizioneTracciata(o: ShopifyOrdine): boolean {
  return (o.fulfillments || []).some(
    f => f.status !== 'CANCELLED' && (f.trackingInfo || []).some(t => t.number)
  );
}

/**
 * Nessun presidio "fuori perimetro".
 *
 * Deciso da Checkpoint l'1/09: gli ordini precedenti al day 1 non interessano,
 * punto. Non e' una semplificazione tecnica ma una regola di prodotto — il
 * perimetro operativo COMINCIA il 24 luglio, e cio' che sta prima non esiste
 * per questo cruscotto. Contarli, mostrarli o segnalarli sarebbe rumore su cui
 * nessuno deve agire.
 */

export async function caricaOrdini(opts: { shop?: string; forza?: boolean } = {}): Promise<{
  ordini: OrdineApp[]; config: Config; pagineLette: number; troncato: boolean;
  caricatoIl: string; dataInizio: string;
}> {
  const shop = opts.shop;
  const config = await caricaConfig(shop);
  const dataInizio = config.dataInizio;
  const key = `${shop || 'default'}|${dataInizio}`;
  const hit = cacheOrdini.get(key);

  if (!opts.forza && hit && hit.scade > Date.now()) {
    return { ordini: hit.dato, config, pagineLette: 0, troncato: false,
             caricatoIl: new Date(hit.scade - TTL_MS).toISOString(), dataInizio };
  }

  const grezzi: ShopifyOrdine[] = [];
  let pagine = 0;
  let troncato = false;

  const pagina = async (q: string, maxPagine: number): Promise<ShopifyOrdine[]> => {
    const out: ShopifyOrdine[] = [];
    let cursor: string | null = null;
    let n = 0;
    do {
      const d: any = await adminGraphQL(Q_ORDINI_LISTA, { q, cursor }, { shop });
      out.push(...(d.orders.nodes as ShopifyOrdine[]));
      cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
      pagine++;
      if (++n >= maxPagine && cursor) { troncato = true; cursor = null; }
    } while (cursor);
    return out;
  };

  grezzi.push(...await pagina(queryPerimetro(dataInizio), MAX_PAGINE));

  /* Recupero dei ritiri effettivamente spediti (vedi queryRitiri).
     Un fallimento qui non deve far cadere le liste: e' un recupero, non la sorgente. */
  try {
    const ritiri = await pagina(queryRitiri(dataInizio), 2);
    for (const o of ritiri) {
      if (haSpedizioneTracciata(o)) grezzi.push({ ...o, ritiroInNegozio: true });
    }
  } catch { /* il perimetro principale resta valido */ }

  /* Recupero dei rimborsati con la merce gia' partita (vedi queryRimborsati).
     Anche qui un fallimento non deve far cadere le liste. */
  try {
    grezzi.push(...await pagina(queryRimborsati(dataInizio), 2));
  } catch { /* il perimetro principale resta valido */ }

  const ora = new Date();
  // risolviNomiSocieta lavora sull'insieme: senza, la stessa societa' comparirebbe
  // due volte ogni volta che il tag soc_nome manca su qualche ordine.
  const classificati = risolviNomiSocieta(grezzi.map(o => classifica(o, config, ora)));

  /* Dei rimborsati totali sopravvive SOLO chi e' in viaggio: la presa in carico del
     corriere e' l'unica ragione per cui un ordine che nessuno spedira' merita di stare
     in un cruscotto operativo. Il filtro sta qui e non nella query perche' la presa in
     carico si sa solo dopo aver letto il riassunto delle spedizioni. */
  const ordini = classificati.filter(o => !o.rimborsatoTotale || o.fase === 'da_monitorare');
  cacheOrdini.set(key, { dato: ordini, scade: Date.now() + TTL_MS });

  return { ordini, config, pagineLette: pagine, troncato,
           caricatoIl: ora.toISOString(), dataInizio };
}

/**
 * Dettaglio di un ordine ancora attivo: qui gli eventi si leggono per intero.
 *
 * Su un ordine già consegnato questa chiamata non deve avvenire. La schermata
 * operativa non può nemmeno arrivarci, perché quegli ordini non vengono caricati;
 * la guardia sotto esiste per il caso di confine — la consegna arriva mentre il
 * dettaglio è aperto — e per non introdurre una lettura che la regola vieta.
 */
export async function caricaOrdine(id: string, shop?: string): Promise<OrdineApp | null> {
  const config = await caricaConfig(shop);
  const d = await adminGraphQL<{ order: ShopifyOrdine | null }>(Q_ORDINE_DETTAGLIO, { id }, { shop });
  return d.order ? classifica(d.order, config) : null;
}

/** Scrittura di un metafield. È l'UNICA scrittura che l'app esegue su Shopify. */
export async function scriviMetafield(
  ownerId: string, namespace: string, key: string, value: unknown, shop?: string
): Promise<void> {
  const d = await adminGraphQL<{ metafieldsSet: { userErrors: { message: string }[] } }>(
    M_SET_METAFIELD,
    { metafields: [{ ownerId, namespace, key, type: 'json', value: JSON.stringify(value) }] },
    { shop }
  );
  const err = d.metafieldsSet.userErrors;
  if (err?.length) throw new Error(`Scrittura metafield rifiutata: ${err.map(e => e.message).join(' · ')}`);
  cacheOrdini.clear();
}

export function invalidaCache(): void { cacheOrdini.clear(); cacheConfig.clear(); }
export { METAFIELD_CONFIG };
