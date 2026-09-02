'use client';
import type { OrdineApp } from '@/lib/classify';

export interface DefFiltro {
  k: string; label: string; tipo?: 'testo' | 'data';
  opzioni?: () => [string, string][];
  test: (o: OrdineApp, v: string) => unknown;
}
export interface Rapido { k: string; label: string; test?: (o: OrdineApp) => unknown }

export function applica(list: OrdineApp[], defs: DefFiltro[], valori: Record<string, string>) {
  return list.filter(o => defs.every(d => { const v = valori[d.k]; return !v || d.test(o, v); }));
}

export function BarraRapidi(
  { rapidi, attivo, imposta, base }:
  { rapidi: Rapido[]; attivo: string | null; imposta: (k: string | null) => void; base: OrdineApp[] }
) {
  return (
    <div className="quick">
      {rapidi.map(r => (
        <button key={r.k} className={`chip ${attivo === r.k ? 'on' : ''}`}
          onClick={() => imposta(attivo === r.k ? null : r.k)}>
          {r.label}<span className="c">{r.test ? base.filter(r.test).length : base.length}</span>
        </button>
      ))}
    </div>
  );
}

export function BarraFiltri(
  { defs, valori, imposta, azzera }:
  { defs: DefFiltro[]; valori: Record<string, string>; imposta: (k: string, v: string) => void; azzera: () => void }
) {
  const attivi = Object.values(valori).filter(Boolean).length;
  return (
    <div className="filters">
      {defs.map(d => (
        <div className="f" key={d.k}>
          <label>{d.label}</label>
          {d.tipo === 'testo' || d.tipo === 'data'
            ? <input type={d.tipo === 'data' ? 'date' : 'text'}
                value={valori[d.k] ?? ''} onChange={e => imposta(d.k, e.target.value)} />
            : <select value={valori[d.k] ?? ''} onChange={e => imposta(d.k, e.target.value)}>
                <option value="">Tutti</option>
                {(d.opzioni?.() ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>}
        </div>
      ))}
      <button className="reset" onClick={azzera}>Azzera filtri{attivi ? ` (${attivi})` : ''}</button>
    </div>
  );
}
