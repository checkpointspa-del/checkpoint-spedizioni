/**
 * Query Admin GraphQL.
 *
 * Regola di costo: nelle LISTE non si scendono mai i fulfillment event
 * (connessione annidata, costo N×F×E). Le tappe arrivano dal metafield
 * `checkpoint.spedizione_stato`, che è un campo e costa 1.
 * Gli eventi si leggono per intero SOLO sul singolo ordine.
 */

const FRAGMENT_INDIRIZZO = `
  shippingAddress {
    name city province provinceCode country countryCodeV2 zip
  }`;

/** Lista operativa: economica, adatta a centinaia di ordini. */
export const Q_ORDINI_LISTA = `
query OrdiniLista($q: String!, $cursor: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      updatedAt
      cancelledAt
      tags
      note
      displayFulfillmentStatus
      displayFinancialStatus
      currentSubtotalLineItemsQuantity
      customer { displayName }
      ${FRAGMENT_INDIRIZZO}
      snapshot: metafield(namespace: "checkpoint", key: "spedizione_stato") { value updatedAt }
      ticket:   metafield(namespace: "checkpoint", key: "spedizione_ticket") { value updatedAt }
      fulfillments(first: 5) {
        id
        createdAt
        status
        displayStatus
        trackingInfo(first: 3) { number company url }
      }
    }
  }
}`;

/** Dettaglio di un singolo ordine: qui gli eventi si leggono tutti. */
export const Q_ORDINE_DETTAGLIO = `
query OrdineDettaglio($id: ID!) {
  order(id: $id) {
    id
    name
    createdAt
    updatedAt
    cancelledAt
    cancelReason
    tags
    note
    displayFulfillmentStatus
    displayFinancialStatus
    currentSubtotalLineItemsQuantity
    customer { displayName email }
    ${FRAGMENT_INDIRIZZO}
    snapshot: metafield(namespace: "checkpoint", key: "spedizione_stato") { value updatedAt }
    ticket:   metafield(namespace: "checkpoint", key: "spedizione_ticket") { value updatedAt }
    refunds(first: 10) { id createdAt }
    lineItems(first: 50) { nodes { title quantity sku } }
    fulfillments(first: 10) {
      id
      createdAt
      status
      displayStatus
      trackingInfo(first: 3) { number company url }
      events(first: 100, sortKey: HAPPENED_AT) {
        nodes { id status happenedAt message address1 city province country }
      }
    }
  }
}`;

/**
 * Configurazione dell'app.
 *
 * Vive su un metafield dell'INSTALLAZIONE dell'app, non dello shop.
 *  - è configurazione dell'app, non dato commerciale del negozio: sull'installazione
 *    è dove appartiene;
 *  - non richiede alcuno scope aggiuntivo (un'app scrive sempre i metafield della
 *    propria installazione), mentre un metafield di shop richiederebbe permessi che
 *    questa app non ha e non deve chiedere;
 *  - non va definito a mano: si crea da solo al primo salvataggio, e resta invisibile
 *    nell'Admin perché non è roba che il negoziante debba vedere.
 */
export const Q_CONFIG = `
query ConfigApp {
  currentAppInstallation {
    id
    metafield(namespace: "checkpoint", key: "spedizioni_config") { value updatedAt }
    # Scope realmente concessi. Shopify tronca a 60 giorni in silenzio quando
    # read_all_orders manca: l'app deve poterlo dire, non subirlo.
    accessScopes { handle }
  }
  shop { name ianaTimezone }
}`;

export const M_SET_METAFIELD = `
mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key namespace updatedAt }
    userErrors { field message code }
  }
}`;
