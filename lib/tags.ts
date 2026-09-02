/**
 * Lettura dei tag ordine. Sola lettura: l'app non scrive tag su Shopify
 * finché la scrittura non è espressamente autorizzata.
 *
 * Tag riconosciuti:
 *   codice_soc=…  soc_nome=…  soc_categoria=…  soc_atleta=…
 *   spedizione_prevista=AAAA-MM-GG
 *   alert                      (tag sorgente, scritto da altri)
 *   consegnato                 (scritto da checkpoint-tracking)
 *   spedizione_problema        (danno/smarrimento, scritto da checkpoint-tracking)
 *   reso_in_rientro            (rientro al mittente, scritto da checkpoint-tracking)
 *
 * ATTENZIONE alla convenzione. checkpoint-tracking scrive questi due tag con
 * l'UNDERSCORE (lib/tags.js, APP_TAGS.PROBLEM e APP_TAGS.RETURNING). Questo file
 * cercava la variante col trattino: `tagProblema` e `tagRientro` erano quindi
 * sempre falsi in esercizio, e con loro sparivano lo stato `rientro_mittente` e
 * l'alert `danneggiata`. Ora si accettano entrambe le forme, cosi' un eventuale
 * tag storico col trattino non viene comunque perso.
 */
import { isIsoDate } from './dates';

export const CHIAVI_SOC = ['codice_soc', 'soc_nome', 'soc_categoria', 'soc_atleta'] as const;
export type ChiaveSoc = typeof CHIAVI_SOC[number];

export interface TagLetti {
  soc: Partial<Record<ChiaveSoc, string>>;
  /** tutte le occorrenze di spedizione_prevista, anche non valide */
  previsteGrezze: string[];
  previsteValide: string[];
  /** vince la data più lontana fra quelle valide */
  prevista: string | null;
  tagAlert: boolean;
  tagConsegnato: boolean;
  tagProblema: boolean;
  tagRientro: boolean;
  /** chiavi società comparse più di una volta */
  duplicati: ChiaveSoc[];
  altri: string[];
}

export function leggiTag(tags: readonly string[] | null | undefined): TagLetti {
  const soc: Partial<Record<ChiaveSoc, string>> = {};
  const previsteGrezze: string[] = [];
  const duplicati: ChiaveSoc[] = [];
  const altri: string[] = [];
  let tagAlert = false, tagConsegnato = false, tagProblema = false, tagRientro = false;

  for (const raw of tags || []) {
    const t = raw.trim();
    // Confronto normalizzato: trattino e underscore valgono lo stesso.
    const n = t.toLowerCase().replace(/-/g, '_');
    if (n === 'alert')               { tagAlert = true; continue; }
    if (n === 'consegnato')          { tagConsegnato = true; continue; }
    if (n === 'spedizione_problema') { tagProblema = true; continue; }
    if (n === 'reso_in_rientro')     { tagRientro = true; continue; }

    const i = t.indexOf('=');
    if (i < 0) { altri.push(t); continue; }
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();

    if (k === 'spedizione_prevista') { previsteGrezze.push(v); continue; }
    if ((CHIAVI_SOC as readonly string[]).includes(k)) {
      const key = k as ChiaveSoc;
      if (soc[key] !== undefined) duplicati.push(key);
      soc[key] = v;
      continue;
    }
    altri.push(t);
  }

  const previsteValide = previsteGrezze.filter(isIsoDate);
  return {
    soc, previsteGrezze, previsteValide,
    prevista: previsteValide.length ? [...previsteValide].sort().pop()! : null,
    tagAlert, tagConsegnato, tagProblema, tagRientro, duplicati, altri
  };
}
