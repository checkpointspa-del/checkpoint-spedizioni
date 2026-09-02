# Messa in esercizio — checkpoint-spedizioni

Aggiornato l'1/09/2026, dopo la messa in esercizio di `checkpoint-tracking`.

Perimetro: **solo ordini non consegnati**, filtrati alla sorgente. L'app non costruisce
archivi. Statistiche ed esportazioni sono la fase finale.

## Stato di partenza verificato sullo store (01/09)

| Cosa | Stato |
|---|---|
| Definizioni metafield ordine `checkpoint.spedizione_stato` e `…_ticket` | ✅ gia' create, tipo json |
| Riassunti seminati sugli ordini aperti | ✅ 97 scritti + 18 dal webhook |
| Tag `consegnato` riallineato | ✅ dal 03/07, perimetro 170 ordini |
| Progetto Vercel `checkpoint-spedizioni` | ❌ **non esiste, va creato** |
| App nel Shopify Dev Dashboard | ❌ da creare |
| `read_all_orders` | ❌ scope protetto, **da richiedere** |

## Ordine dei passi, e perche' e' questo

`NEXT_PUBLIC_SHOPIFY_CLIENT_ID` serve **al momento della build**, non a runtime: quindi
l'app Shopify va creata prima del deploy. Ma l'`application_url` definitivo si conosce solo
dopo il deploy. Si passa quindi due volte dal Dev Dashboard, ed e' normale.

### 1. Shopify Dev Dashboard — creare l'app

- nome: `Checkpoint — Cruscotto spedizioni`, **embedded**
- `application_url` provvisorio: qualunque, si corregge al passo 4
- scope: `read_orders`, `read_all_orders`, `read_fulfillments`, `read_customers`, `write_orders`
- annotare **Client ID** e **Client secret** (non finiscono mai nel codice)

### 2. Richiedere `read_all_orders` — subito, perche' richiede approvazione

E' uno scope **protetto**: Shopify lo concede su richiesta motivata, non e' un interruttore.
Motivazione: sorveglianza operativa degli ordini non consegnati, compresi quelli mai chiusi
che superano i 60 giorni e che senza lo scope diventerebbero invisibili.

**Non blocca il go-live.** Senza, l'app funziona sugli ultimi 60 giorni e lo **dichiara**:
`/api/salute` espone `storicoCompleto: false` e un avviso esplicito, e il cruscotto mostra
la banda "oltre il limite API". Quando lo scope arriva, l'avviso sparisce da solo.

### 3. Vercel — creare il progetto e le variabili

```
vercel link        # dalla cartella checkpoint-spedizioni, crea il progetto
```

Variabili (Production e Preview), nessun token statico:

```
SHOPIFY_SHOP=checkpointspa.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_API_VERSION=2026-07
NEXT_PUBLIC_SHOPIFY_CLIENT_ID=<stesso valore di SHOPIFY_CLIENT_ID>
```

Poi `vercel --prod` e annotare l'URL di produzione.

### 4. Shopify Dev Dashboard — chiudere il cerchio

- `application_url` = URL di produzione Vercel
- redirect URLs: `<url>/api/auth` e `<url>/api/auth/callback`
- allineare `shopify.app.toml` allo stesso dominio
- installare l'app sullo store

## Verifiche dopo il deploy, in quest'ordine

1. `GET /api/salute` → `shopify: raggiungibile`, elenco scope, `storicoCompleto`.
2. Aprire l'app dall'Admin. Se compare "App Bridge non disponibile": l'app non e' embedded
   oppure manca `NEXT_PUBLIC_SHOPIFY_CLIENT_ID` **al momento della build** (rideployare
   dopo aver impostato la variabile, non basta aggiungerla).
3. Il cruscotto deve mostrare **170 ordini** nel perimetro: e' il numero verificato l'1/09.
   Se ne mostra molti meno, il session token non sta autenticando e le liste tornano vuote.
4. **Confrontare "Da spedire" con la realta' del magazzino** su una decina di ordini. E' il
   controllo che conta davvero, perche' verifica la regola dell'uscita dal magazzino.
5. Verificare che gli ordini con alert **Collo non partito** siano davvero fermi in
   magazzino: 26CKPT2423, 26CKPT2619, 26CKPT2626 sono i casi noti piu' vecchi.
6. Prendere un ordine appena consegnato e ricaricare: **non deve piu' comparire da nessuna
   parte**.
7. Cambiare uno stato ticket e riaprire l'ordine: deve persistere (e' un metafield).
8. Vista societa' → categoria → atleta: mai provata su dati reali, e' l'ultima voce da
   collaudare.

## Da sistemare sulle definizioni metafield

`spedizione_stato` e `spedizione_ticket` hanno `access.storefront = PUBLIC_READ`.
Contengono numeri di tracking, date, note operative e nome dell'operatore: non e' roba da
Storefront API. Portare l'accesso storefront a **NONE**. `admin: PUBLIC_READ_WRITE` invece
va tenuto: e' cio' che permette a `checkpoint-spedizioni` di leggere metafield scritti da
`checkpoint-tracking`, che sono due app diverse.

## Rischi noti

| Rischio | Effetto | Mitigazione |
|---|---|---|
| `read_all_orders` non concesso | storico limitato a 60 giorni, in silenzio | `/api/salute` lo dichiara, il cruscotto mostra l'avviso |
| Riassunto assente su un ordine aperto | liste meno complete | ricalcolo sul dettaglio, dichiarato all'operatore |
| Ritiro mai notificato dal corriere | finestra di consegna che parte tardi | `presaApprossimata`, dichiarato nel dettaglio |
| Throttling GraphQL | letture perse se trattato come errore | HTTP 200 + `THROTTLED` → attesa calcolata e retry |
| LDV mute (ShippyPro non aggancia il tracking) | ordini senza tappe | alert `collo_non_partito`, gravita' crescente |
| Ordine mai chiuso oltre la finestra | sparirebbe dalle viste | presidio per differenza, mostrato come avviso |
