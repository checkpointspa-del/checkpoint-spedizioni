# Checkpoint — Cruscotto spedizioni

App Shopify **embedded** per la gestione operativa delle spedizioni: si apre dentro
l'Admin Shopify, senza credenziali aggiuntive per chi già lavora sullo store.

**Perimetro: solo ordini non consegnati.** Quando tutte le spedizioni necessarie di un
ordine risultano consegnate, l'ordine esce dalle viste operative e non viene più
interrogato. L'app non costruisce alcun archivio: gli ordini chiusi restano su Shopify.

Statistiche, storico, report ed esportazioni sono deliberatamente fuori da questa versione.

---

## Come sta in piedi

```
Admin Shopify  ──iframe + session token──►  App su Vercel
                                              │
                                              ├─ verifica il token con il client secret
                                              ├─ ottiene l'Admin token via Client Credentials Grant
                                              └─ legge/scrive SOLO Shopify (ordini, metafield)
```

**Non c'è database.** Shopify è l'archivio:

| Cosa | Dove vive |
|---|---|
| Ordini, tag, spedizioni, eventi di tracking | Shopify (già oggi) |
| Riassunto delle tappe, solo su ordini aperti | metafield ordine `checkpoint.spedizione_stato` |
| Stato del ticket con il corriere | metafield ordine `checkpoint.spedizione_ticket` |
| Finestre, soglie, festività | metafield dell'installazione dell'app `checkpoint.spedizioni_config` |

Nessun dato statistico viene salvato.

Il riassunto esiste per una ragione di costo, non di comodità: leggere i fulfillment
event per una lista di centinaia di ordini supera di molto il limite di costo del
GraphQL Admin. Il riassunto è un campo, costa 1. La verità restano gli eventi, che la
scheda di dettaglio legge per intero sul singolo ordine. Se il riassunto manca, l'app
lo ricalcola al volo **e lo dichiara**: non lo inventa e non lo nasconde.

Chi scrive il riassunto è `checkpoint-tracking`, che già riceve ogni webhook ShippyPro.
Vedi `docs/estensione-checkpoint-tracking.md`.

## Regole di dominio, in breve

- **Regola terminale:** si interrogano solo spedizioni non consegnate. Il filtro sta nella
  query (`tag_not:consegnato`), non nell'applicazione. Una consegna parziale non chiude
  l'ordine: solo quella spedizione smette di essere monitorata.
- Un ordine lascia **Da spedire** solo con un evento che prova l'uscita fisica dal
  magazzino. `CONFIRMED`, `LABEL_PURCHASED`, `LABEL_PRINTED` e `DELAYED` non bastano.
- **B2B** è la categoria virtuale degli ordini senza alcun tag società. Non richiede
  tag, non è un errore, e compare sempre in fondo con enfasi ridotta.
- Tag società **parziali** non diventano mai B2B: restano nel ramo società con l'alert
  `dati incompleti`.
- Il tag sorgente `alert` e l'**alert applicativo** calcolato dall'app restano distinti.
  **L'app non scrive tag su Shopify.**
- La finestra di consegna si calcola in giorni lavorativi dalla presa in carico effettiva,
  fuso `Europe/Rome`, festività configurabili. Quando manca un evento il valore è
  *Dato non disponibile*, mai una stima.

## Avvio in locale

```bash
npm install
cp .env.example .env.local     # e valorizzare i campi
npm run dev
```

L'app funziona solo **dentro** l'Admin Shopify: fuori dall'iframe App Bridge non emette
session token e le API rispondono 401. Per lo sviluppo si usa il tunnel della Shopify CLI
oppure l'anteprima dell'app dal Dev Dashboard.

Variabili (vedi `.env.example`): `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`,
`SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION`, `NEXT_PUBLIC_SHOPIFY_CLIENT_ID`.
Nessun `SHOPIFY_ADMIN_TOKEN`: l'app ottiene da sola l'access token.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | sviluppo |
| `npm run build` | build di produzione |
| `npm test` | verifica del dominio (21 test) |
| `npm run typecheck` | controllo dei tipi |

## Diagnostica

`GET /api/salute` — espone soltanto i **nomi** delle variabili d'ambiente e se sono
valorizzate, mai i valori. Riporta anche gli scope concessi.

## Struttura

```
lib/            dominio e accesso a Shopify (nessuna regola vive nelle schermate)
  config.ts     finestre, soglie, festività, obiettivo
  dates.ts      giorni lavorativi Europe/Rome
  status.ts     stati normalizzati e prova di uscita dal magazzino
  tags.ts       lettura dei tag ordine
  snapshot.ts   contratto del metafield condiviso con checkpoint-tracking
  classify.ts   derivazione dell'ordine applicativo
  shopify.ts    Client Credentials Grant + GraphQL con gestione del throttling
  session.ts    verifica del session token App Bridge
  store.ts      lettura, cache breve, scrittura metafield
app/api/        endpoint (ordini, dettaglio, ticket, config, salute)
app/schermate/  una schermata per file
scripts/        verifica del dominio
docs/           riassunto delle tappe, messa in esercizio
```
