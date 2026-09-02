/** Tassonomia degli alert. Due famiglie tenute sempre distinte. */

export type Gravita = 'informativo' | 'attenzione' | 'urgente' | 'critico';
export const ORDINE_GRAVITA: Record<Gravita, number> =
  { informativo: 0, attenzione: 1, urgente: 2, critico: 3 };

export type CausaDati =
  | 'tag_alert' | 'data_mancante' | 'data_non_valida'
  | 'soc_incompleta' | 'tag_conflitto' | 'stato_non_interpretabile'
  | 'rimborsato_in_viaggio';

/**
 * QUESTA VISTA CONTIENE SOLO ERRORI VERI. Due cause sono state rimosse il 02/09
 * perche' non lo erano, e vanno lasciate fuori.
 *
 * `tracking_mancante` — l'assenza di tracking non e' un dato da sistemare. Le LDV per
 * le societa' sportive non si creano ogni giorno: un ordine puo' restare legittimamente
 * senza codice per giorni. Un ordine senza tracking si vede gia' dove serve, nella fase
 * di ritiro di "Da spedire".
 *
 * `data_passata` — una data prevista superata non e' un errore di dato, e' un RITARDO.
 * Decisione Checkpoint, testuale: *"se abbiamo sforato con una data non va segnato
 * errore, li voglio solo gli errori veri. Se abbiamo sforato siamo in ritardo, non ho
 * il tempo di modificare la data a tutti"*. L'evidenza del ritardo esiste gia' ed e'
 * quella giusta: il blocco "In ritardo" dentro *Da spedire*, piu' il filtro rapido
 * "Data superata". Chiedere all'operatore di riscrivere il tag su decine di ordini per
 * far sparire un alert e' lavoro inventato.
 *
 * Il criterio: in "Dati da sistemare" entra solo cio' che qualcuno puo' e deve
 * CORREGGERE. Un ritardo non si corregge cambiando un tag, si smaltisce spedendo.
 */

export const CAUSE_DATI: Record<CausaDati, { label: string; gravita: Gravita; azione: string }> = {
  tag_alert:      { label: 'Tag alert presente', gravita: 'attenzione',
                    azione: 'Verificare a monte il motivo del flag e rimuoverlo quando risolto.' },
  data_mancante:  { label: 'Data di spedizione prevista mancante', gravita: 'urgente',
                    azione: 'Aggiungere il tag spedizione_prevista=AAAA-MM-GG all’ordine.' },
  data_non_valida:{ label: 'Data di spedizione prevista non valida', gravita: 'urgente',
                    azione: 'Correggere il formato del tag: solo ISO AAAA-MM-GG.' },
  soc_incompleta: { label: 'Dati società incompleti', gravita: 'attenzione',
                    azione: 'Completare i tag società mancanti. Non è un ordine B2C.' },
  tag_conflitto:  { label: 'Tag duplicati o in conflitto', gravita: 'attenzione',
                    azione: 'Rimuovere i tag duplicati, tenere un solo valore valido.' },
  stato_non_interpretabile: { label: 'Stato non interpretabile', gravita: 'urgente',
                    azione: 'Stato del corriere non mappato: verificare dal portale del vettore.' },
  /**
   * Rimborsato, ma la merce sta viaggiando.
   *
   * Gli ordini rimborsati NON entrano nel perimetro: non verranno mai spediti.
   * L'unica eccezione e' questa — il rimborso e' stato registrato su un ordine la cui
   * merce il corriere ha gia' preso in carico. Puo' essere un rientro corretto, ma puo'
   * anche essere un rimborso emesso per errore: soldi resi e merce partita insieme.
   * Va visto lo stesso giorno, non a fine mese.
   */
  rimborsato_in_viaggio: { label: 'Ordine rimborsato con merce in viaggio', gravita: 'critico',
                    azione: 'Verificare se il rimborso è corretto o emesso per errore, e se la merce va fermata o rientra.' }
};

export type CausaSpedizione =
  | 'collo_non_partito' | 'nessun_evento' | 'mancata_presa' | 'tracking_fermo' | 'oltre_finestra'
  | 'eccezione_corriere' | 'giacenza' | 'destinatario_assente' | 'indirizzo_errato'
  | 'danneggiata' | 'rifiutata' | 'smarrimento' | 'rientro_mittente'
  | 'non_riconosciuto' | 'non_interpretabile';

/**
 * DUE FAMIGLIE, DUE POSTI DIVERSI. Deciso il 02/09.
 *
 * La regola, testuale: *"se l'ordine deve ancora partire dal nostro magazzino non ha
 * senso che sia in nessuno di quei due"* — cioe' ne' in «Alert spedizione» ne' in
 * «Ticket corrieri».
 *
 * MAGAZZINO (queste tre) = la merce e' ancora da noi. Il corriere non ce l'ha, quindi
 * non c'e' niente da contestargli: si guarda in magazzino, si sollecita il ritiro.
 * Vivono in «Da spedire», che e' dove l'operatore lavora questi ordini.
 *
 * VETTORE (tutte le altre) = il corriere ha preso in carico la merce ed e' successo
 * qualcosa. Solo queste vanno in «Alert spedizione», e solo da queste puo' nascere un
 * ticket al vettore.
 *
 * Il discrimine non e' la causa ma la PRESA IN CARICO: `fase === 'da_monitorare'`.
 */
export const CAUSE_MAGAZZINO: readonly CausaSpedizione[] =
  ['collo_non_partito', 'nessun_evento', 'mancata_presa'];

export const CAUSE_SPEDIZIONE: Record<CausaSpedizione, { label: string; azione: string }> = {
  /**
   * ZERO eventi: il corriere non ha mai visto il collo.
   * Verificato sui dati reali (01/09): non e' un ritardo del vettore ne' un difetto
   * di ShippyPro, sono colli con LDV gia' stampata **fermi nel nostro magazzino**.
   * Il 76% di questi ordini non ha nemmeno il tag `spedizione_prevista`: nessuno
   * sa che esistono. E' il caso che il cruscotto deve far emergere per primo.
   */
  collo_non_partito:  { label: 'Collo non partito',
                        azione: 'LDV creata ma mai presa in carico: verificare in magazzino se il collo e\u2019 ancora fermo.' },
  nessun_evento:      { label: 'Nessun evento dopo la creazione del tracking',
                        azione: 'Verificare che il collo sia stato consegnato al corriere.' },
  mancata_presa:      { label: 'Mancata presa in carico',
                        azione: 'Sollecitare il ritiro o riprogrammare il passaggio.' },
  tracking_fermo:     { label: 'Tracking fermo da tempo anomalo',
                        azione: 'Aprire ticket di sollecito al corriere.' },
  oltre_finestra:     { label: 'Superamento della finestra di consegna',
                        azione: 'Aprire ticket di ricerca merce presso il corriere.' },
  eccezione_corriere: { label: 'Eccezione comunicata dal corriere',
                        azione: 'Leggere la nota del vettore e contattare il destinatario.' },
  giacenza:           { label: 'Spedizione in giacenza',
                        azione: 'Contattare il destinatario e concordare la riconsegna entro i termini.' },
  destinatario_assente:{ label: 'Destinatario assente',
                        azione: 'Ricontattare il destinatario per un nuovo appuntamento.' },
  indirizzo_errato:   { label: 'Indirizzo errato o incompleto',
                        azione: 'Correggere l’indirizzo e richiedere la riconsegna.' },
  danneggiata:        { label: 'Spedizione danneggiata',
                        azione: 'Aprire pratica danni con documentazione fotografica.' },
  rifiutata:          { label: 'Spedizione rifiutata',
                        azione: 'Verificare con il cliente e predisporre il rientro.' },
  smarrimento:        { label: 'Possibile smarrimento',
                        azione: 'Aprire pratica di ricerca merce. Valutare la rispedizione.' },
  rientro_mittente:   { label: 'Rientro al mittente',
                        azione: 'Attendere il rientro, verificare la causa e riprogrammare.' },
  non_riconosciuto:   { label: 'Tracking non riconosciuto dal corriere',
                        azione: 'Verificare il codice: possibile LDV errata o non acquisita.' },
  non_interpretabile: { label: 'Stato del corriere non interpretabile',
                        azione: 'Controllare manualmente il portale del vettore.' }
};

export type StatoTicket =
  | 'da_verificare' | 'ticket_da_aprire' | 'ticket_aperto' | 'attesa_corriere'
  | 'risposta_ricevuta' | 'risolto' | 'chiuso_senza';

export const STATI_TICKET: Record<StatoTicket, string> = {
  da_verificare: 'Da verificare',
  ticket_da_aprire: 'Ticket da aprire',
  ticket_aperto: 'Ticket aperto',
  attesa_corriere: 'In attesa del corriere',
  risposta_ricevuta: 'Risposta ricevuta',
  risolto: 'Risolto',
  chiuso_senza: 'Chiuso senza intervento'
};

export interface Ticket {
  stato: StatoTicket;
  apertoIl: string | null;
  operatore: string | null;
  corriere: string | null;
  riferimento: string | null;
  note: string | null;
  aggiornatoIl: string | null;
  prossimoControllo: string | null;
  esito: string | null;
}
