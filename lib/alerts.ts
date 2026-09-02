/** Tassonomia degli alert. Due famiglie tenute sempre distinte. */

export type Gravita = 'informativo' | 'attenzione' | 'urgente' | 'critico';
export const ORDINE_GRAVITA: Record<Gravita, number> =
  { informativo: 0, attenzione: 1, urgente: 2, critico: 3 };

export type CausaDati =
  | 'tag_alert' | 'data_mancante' | 'data_non_valida' | 'data_passata'
  | 'soc_incompleta' | 'tag_conflitto' | 'stato_non_interpretabile'
  | 'rimborsato_in_viaggio';

/**
 * NON esiste piu' la causa `tracking_mancante`.
 *
 * Deciso da Checkpoint il 02/09: l'assenza di tracking NON e' un dato da sistemare.
 * Le LDV per le societa' sportive non si creano ogni giorno — un ordine puo' restare
 * legittimamente senza codice per giorni. Segnalarlo come alert "urgente" produceva
 * decine di righe rosse su cui nessuno doveva agire, e faceva perdere di vista gli
 * alert veri. Un ordine senza tracking si vede gia' dove serve: nella fase di ritiro
 * di "Da spedire". Non reintrodurre la causa.
 */

export const CAUSE_DATI: Record<CausaDati, { label: string; gravita: Gravita; azione: string }> = {
  tag_alert:      { label: 'Tag alert presente', gravita: 'attenzione',
                    azione: 'Verificare a monte il motivo del flag e rimuoverlo quando risolto.' },
  data_mancante:  { label: 'Data di spedizione prevista mancante', gravita: 'urgente',
                    azione: 'Aggiungere il tag spedizione_prevista=AAAA-MM-GG all’ordine.' },
  data_non_valida:{ label: 'Data di spedizione prevista non valida', gravita: 'urgente',
                    azione: 'Correggere il formato del tag: solo ISO AAAA-MM-GG.' },
  data_passata:   { label: 'Data prevista superata', gravita: 'urgente',
                    azione: 'Spedire oppure aggiornare la data prevista.' },
  soc_incompleta: { label: 'Dati società incompleti', gravita: 'attenzione',
                    azione: 'Completare i tag società mancanti. Non è un ordine B2B.' },
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
