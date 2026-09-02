'use client';
import type { OrdineApp } from '@/lib/classify';
import type { Config } from '@/lib/config';
import { Badge, StatoBadge, D, Vuoto } from '../ui';
import { BarraFiltri, DefFiltro, applica } from './Filtri';

/**
 * Gerarchia società → categoria → atleta → ordini.
 *
 * Mostra solo ordini ANCORA ATTIVI: un ordine consegnato non viene nemmeno
 * caricato da Shopify, quindi qui non può comparire.
 *
 * Il gruppo virtuale B2B resta sempre in fondo e con enfasi ridotta, qualunque
 * sia l'ordinamento: raccoglie gli ordini senza alcun tag società e non richiede
 * di aggiungerne uno.
 */
interface Nodo { nome: string; ordini: OrdineApp[] }
interface Categoria extends Nodo { atleti: Map<string, Nodo> }
interface Gruppo extends Nodo { b2b: boolean; categorie: Map<string, Categoria> }

export default function Societa(
  { ordini, config, filtri, imposta, azzera, aperti, alterna, apri, opzioni }:
  { ordini: OrdineApp[]; config: Config;
    filtri: Record<string, string>; imposta: (k: string, v: string) => void; azzera: () => void;
    aperti: Record<string, boolean>; alterna: (k: string) => void;
    apri: (id: string) => void; opzioni: Record<string, () => [string, string][]> }
) {
  const defs: DefFiltro[] = [
    { k: 'b2b', label: 'Gruppo B2B', opzioni: () => [['includi', 'Includi B2B'], ['escludi', 'Escludi B2B']],
      test: (o, v) => (v === 'escludi' ? !o.isB2B : true) },
    { k: 'fase', label: 'Fase', opzioni: () => [['da_spedire', 'Da spedire'], ['da_monitorare', 'Da monitorare']],
      test: (o, v) => o.fase === v },
    { k: 'categoria', label: 'Categoria',
      opzioni: () => [...new Set(ordini.filter(o => !o.isB2B).map(o => o.categoria))].sort().map(v => [v, v] as [string, string]),
      test: (o, v) => o.categoria === v },
    { k: 'corriere', label: 'Corriere', opzioni: opzioni.corriere, test: (o, v) => o.corriere === v },
    { k: 'alert', label: 'Solo con alert',
      opzioni: () => [['dati', 'Alert dati'], ['sped', 'Alert spedizione'], ['any', 'Qualsiasi alert']],
      test: (o, v) => v === 'dati' ? o.alertDati.length
                    : v === 'sped' ? o.alertSpedizione.length
                    : (o.alertDati.length || o.alertSpedizione.length) }
  ];

  const lista = applica(ordini.filter(o => o.attivo), defs, filtri);

  const albero = new Map<string, Gruppo>();
  for (const o of lista) {
    let g = albero.get(o.gruppo);
    if (!g) { g = { nome: o.gruppo, b2b: o.isB2B, ordini: [], categorie: new Map() }; albero.set(o.gruppo, g); }
    g.ordini.push(o);

    const kCat = o.isB2B ? 'Ordini B2B' : o.categoria;
    let c = g.categorie.get(kCat);
    if (!c) { c = { nome: kCat, ordini: [], atleti: new Map() }; g.categorie.set(kCat, c); }
    c.ordini.push(o);

    const kAtl = o.isB2B ? o.cliente : o.atleta;
    let a = c.atleti.get(kAtl);
    if (!a) { a = { nome: kAtl, ordini: [] }; c.atleti.set(kAtl, a); }
    a.ordini.push(o);
  }

  // B2B in fondo, prima di qualunque altro criterio.
  const gruppi = [...albero.values()].sort((x, y) =>
    x.b2b !== y.b2b ? (x.b2b ? 1 : -1) : x.nome.localeCompare(y.nome));

  return (
    <>
      <div className="active-note">
        Gerarchia <b>società → categoria → atleta → ordini</b> sugli ordini ancora attivi.
        Il gruppo <b>{config.etichettaB2B}</b> raccoglie gli ordini senza tag società: non richiede
        alcun tag, non è un errore, e resta sempre in fondo.
      </div>
      <BarraFiltri defs={defs} valori={filtri} imposta={imposta} azzera={azzera} />

      {!gruppi.length ? <Vuoto testo="Nessun ordine attivo con i filtri attivi." /> : (
        <div className="tree">
          {gruppi.map(g => {
            const k1 = `g|${g.nome}`;
            return (
              <div className={`node ${g.b2b ? 'b2b' : ''}`} key={g.nome}>
                <button className="n1" onClick={() => alterna(k1)}>
                  <span className={`car ${aperti[k1] ? 'open' : ''}`}>▶</span>
                  {g.b2b ? <Badge tipo="b2b">{config.etichettaB2B}</Badge> : g.nome}
                  <Riepilogo ordini={g.ordini} />
                </button>

                {aperti[k1] && [...g.categorie.values()]
                  .sort((a, b) => a.nome.localeCompare(b.nome))
                  .map(c => {
                    const k2 = `${k1}|${c.nome}`;
                    return (
                      <div key={c.nome}>
                        <button className="n2" onClick={() => alterna(k2)}>
                          <span className={`car ${aperti[k2] ? 'open' : ''}`}>▶</span>
                          {c.nome}
                          <Riepilogo ordini={c.ordini} />
                        </button>

                        {aperti[k2] && [...c.atleti.values()]
                          .sort((a, b) => b.ordini.length - a.ordini.length || a.nome.localeCompare(b.nome))
                          .map(a => {
                            const k3 = `${k2}|${a.nome}`;
                            return (
                              <div key={a.nome}>
                                <button className="n3" onClick={() => alterna(k3)}>
                                  <span className={`car ${aperti[k3] ? 'open' : ''}`}>▶</span>
                                  {a.nome}
                                  <Riepilogo ordini={a.ordini} />
                                </button>

                                {aperti[k3] && (
                                  <div className="orders-in">
                                    <table className="mini"><tbody>
                                      {a.ordini
                                        .slice()
                                        .sort((x, y) => (x.prevista ?? '9999').localeCompare(y.prevista ?? '9999'))
                                        .map(o => (
                                          <tr key={o.id} onClick={() => apri(o.id)}>
                                            <td className="ordref">{o.nome}</td>
                                            <td>{D(o.ricezione)}</td>
                                            <td>{o.destinazione.citta} ({o.destinazione.provincia})</td>
                                            <td>{o.prevista
                                              ? <>prevista {D(o.prevista)}</>
                                              : <Badge tipo="crit">data assente</Badge>}</td>
                                            <td><StatoBadge o={o} /></td>
                                            <td>
                                              {o.alertDati.length ? <Badge tipo="warn">dati</Badge> : null}
                                              {o.alertSpedizione.length ? <> <Badge tipo="urg">sped.</Badge></> : null}
                                            </td>
                                          </tr>
                                        ))}
                                    </tbody></table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Conteggi che servono a decidere dove guardare, non a misurare prestazioni. */
function Riepilogo({ ordini }: { ordini: OrdineApp[] }) {
  const daSpedire = ordini.filter(o => o.fase === 'da_spedire').length;
  const inViaggio = ordini.filter(o => o.fase === 'da_monitorare').length;
  const ad = ordini.filter(o => o.alertDati.length).length;
  const as = ordini.filter(o => o.alertSpedizione.length).length;
  return (
    <span className="tail">
      {daSpedire ? <Badge tipo="neutral">{daSpedire} da spedire</Badge> : null}
      {inViaggio ? <Badge tipo="info">{inViaggio} in viaggio</Badge> : null}
      {ad ? <Badge tipo="warn">{ad} alert dati</Badge> : null}
      {as ? <Badge tipo="urg">{as} alert sped.</Badge> : null}
    </span>
  );
}
