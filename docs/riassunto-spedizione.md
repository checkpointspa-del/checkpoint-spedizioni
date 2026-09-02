# Riassunto delle tappe — perché esiste e cosa contiene

Il modulo che lo scrive vive in `checkpoint-tracking` ed è già implementato.

## Perché

Le tappe vivono nei fulfillment event di Shopify. Leggerli per una lista di ordini costa
`ordini × spedizioni × eventi` punti di costo GraphQL: a centinaia di ordini la query non
passa. Un metafield è un campo e costa 1.

È l'unico motivo per cui esiste. Non serve a conservare statistiche, e non conserva storico:
tocca solo ordini ancora aperti, e si ferma quando la spedizione è consegnata.

## Contratto

`checkpoint.spedizione_stato`, type `json`. Forma in `lib/snapshot.ts` — è la fonte di
verità, il lato scrittura la rispecchia. Contiene **solo fatti**: date, stato grezzo
dichiarato da Shopify, testo originale del corriere. L'interpretazione la fa questa app in
`lib/status.ts`.

## Regola terminale

| Situazione | Comportamento |
|---|---|
| Arriva un evento su una spedizione attiva | il riassunto si aggiorna nello stesso passaggio in cui si scrive il fulfillment event |
| Nasce una spedizione | il riassunto si inizializza con codice, corriere e data della LDV |
| Arriva `DELIVERED` | si registra la data e la spedizione diventa **terminale** |
| Tutte le spedizioni non annullate sono terminali | l'ordine riceve il tag `consegnato` ed esce dalle viste operative |
| Consegna parziale | l'ordine **resta** operativo; solo quella spedizione smette di essere monitorata |
| Webhook tardivo o duplicato su spedizione terminale | nessuna scrittura, nessuna riapertura, data di consegna invariata |
| Niente è cambiato | il metafield **non** viene riscritto |
| La scrittura fallisce | loggata e ignorata: non compromette la sincronizzazione dello stato |
| Il riassunto manca su un ordine **aperto** | l'app lo ricalcola per quell'ordine e lo dichiara in cima alla cronologia |

Il filtro alla sorgente del cruscotto è `tag_not:consegnato`: gli ordini chiusi non vengono
caricati e poi scartati, non arrivano proprio. Non può essere il metafield, perché i
metafield di tipo `json` non sono filtrabili.
