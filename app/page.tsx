'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OrdineApp } from '@/lib/classify';
import type { Config } from '@/lib/config';
import { CONFIG_DEFAULT } from '@/lib/config';
import { api, ErroreApi } from '@/lib/client';
import Cruscotto from './schermate/Cruscotto';
import DaSpedire from './schermate/DaSpedire';
import DaMonitorare from './schermate/DaMonitorare';
import { AlertDati, AlertSpedizione } from './schermate/Alert';
import TicketScreen from './schermate/Ticket';
import Configurazione from './schermate/Configurazione';
import Societa from './schermate/Societa';
import Dettaglio from './schermate/Dettaglio';

export type Vista = 'cruscotto' | 'societa' | 'spedire' | 'monitorare'
                  | 'dati' | 'alert' | 'ticket' | 'config';

const VISTE: Record<Vista, { titolo: string; icona: string; sottotitolo: string }> = {
  cruscotto:  { titolo: 'Cruscotto',              icona: '▦', sottotitolo: 'Panoramica operativa della giornata' },
  societa:    { titolo: 'Società sportive',       icona: '◈', sottotitolo: 'Società → categoria → atleta → ordini' },
  spedire:    { titolo: 'Da spedire',             icona: '▤', sottotitolo: 'Ordini non ancora usciti dal magazzino, colli fermi compresi' },
  monitorare: { titolo: 'Da monitorare',          icona: '◎', sottotitolo: 'Spedizioni prese in carico dal corriere' },
  dati:       { titolo: 'Dati da sistemare',      icona: '⚑', sottotitolo: 'Alert calcolati dall’app — nessun tag scritto su Shopify' },
  alert:      { titolo: 'Alert spedizione',       icona: '▲', sottotitolo: 'Che cosa non va — solo su merce che il corriere ha già ritirato' },
  ticket:     { titolo: 'Ticket corrieri',        icona: '✉', sottotitolo: 'Che cosa stiamo facendo — pratiche da aprire o già aperte col vettore' },
  config:     { titolo: 'Configurazione',         icona: '⚙', sottotitolo: 'Finestre, soglie ed eventi di presa in carico' }
};

const oggiRoma = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function Pagina() {
  const [ordini, setOrdini] = useState<OrdineApp[]>([]);
  const [config, setConfig] = useState<Config>(CONFIG_DEFAULT);
  const [stato, setStato] = useState<'carico' | 'pronto' | 'errore'>('carico');
  const [errore, setErrore] = useState<string | null>(null);
  const [troncato, setTroncato] = useState(false);
  const [dataInizio, setDataInizio] = useState<string | null>(null);
  const [caricatoIl, setCaricatoIl] = useState<string | null>(null);

  const [vista, setVista] = useState<Vista>('cruscotto');
  const [ricerca, setRicerca] = useState('');
  const [filtri, setFiltri] = useState<Record<Vista, Record<string, string>>>({} as any);
  const [rapidi, setRapidi] = useState<Record<string, string | null>>({});
  const [aperto, setAperto] = useState<string | null>(null);
  const [espansi, setEspansi] = useState<Record<string, boolean>>({});
  const [salvaConfig, setSalvaConfig] = useState(false);

  const carica = useCallback(async (forza = false) => {
    try {
      setStato(s => (s === 'pronto' ? s : 'carico'));
      const r = await api<{ ordini: OrdineApp[]; config: Config; troncato: boolean;
                           caricatoIl: string; dataInizio: string }>(
        `/api/ordini${forza ? '?forza=1' : ''}`);
      setOrdini(r.ordini); setConfig(r.config); setTroncato(r.troncato);
      setDataInizio(r.dataInizio);
      setCaricatoIl(r.caricatoIl); setStato('pronto'); setErrore(null);
    } catch (e) {
      setErrore(e instanceof ErroreApi ? e.message : 'Errore imprevisto');
      setStato('errore');
    }
  }, []);

  useEffect(() => { void carica(); }, [carica]);

  const filtrati = useMemo(() => {
    const q = ricerca.trim().toLowerCase();
    return q ? ordini.filter(o => o.ricerca.includes(q)) : ordini;
  }, [ordini, ricerca]);

  const opzioni = useMemo(() => {
    const uniq = (a: (string | null | undefined)[]) =>
      [...new Set(a.filter(Boolean) as string[])].sort();
    return {
      gruppo: () => [
        ...uniq(ordini.filter(o => !o.isB2C).map(o => o.socNome)).map(v => [v, v] as [string, string]),
        ['B2C', 'B2C (in fondo)'] as [string, string]
      ],
      corriere:  () => uniq(ordini.map(o => o.corriere)).map(v => [v, v] as [string, string]),
      paese:     () => uniq(ordini.map(o => o.destinazione.paese)).map(v => [v, v] as [string, string]),
      regione:   () => uniq(ordini.map(o => o.destinazione.regione)).map(v => [v, v] as [string, string]),
      provincia: () => uniq(ordini.map(o => o.destinazione.provincia)).map(v => [v, v] as [string, string])
    };
  }, [ordini]);

  const conta = useMemo(() => ({
    spedire:    ordini.filter(o => o.fase === 'da_spedire').length,
    monitorare: ordini.filter(o => o.fase === 'da_monitorare').length,
    dati:       ordini.filter(o => o.alertDati.length).length,
    alert:      ordini.filter(o => o.alertSpedizione.length).length,
    critici:    ordini.filter(o => o.gravitaSpedizione === 'critico').length,
    ticket:     ordini.filter(o => o.ticketDaAprire || o.ticketAperto).length,
    societa:    ordini.filter(o => !o.isB2C && o.attivo).length
  }), [ordini]);

  const setF = (k: string, v: string) =>
    setFiltri(f => ({ ...f, [vista]: { ...(f[vista] ?? {}), [k]: v } }));
  const azzeraF = () => { setFiltri(f => ({ ...f, [vista]: {} })); setRapidi(r => ({ ...r, [vista]: null })); };
  const vaiA = (v: Vista, rapido?: string) => {
    setVista(v);
    setFiltri(f => ({ ...f, [v]: {} }));
    setRapidi(r => ({ ...r, [v]: rapido ?? null }));
    window.scrollTo(0, 0);
  };
  const f = filtri[vista] ?? {};
  const rapido = rapidi[vista] ?? null;
  const setRapido = (k: string | null) => setRapidi(r => ({ ...r, [vista]: k }));

  async function salvaConfigurazione(c: Config) {
    setConfig(c);
    setSalvaConfig(true);
    try { await api('/api/config', { method: 'PUT', body: JSON.stringify(c) }); await carica(true); }
    catch (e) { setErrore(e instanceof Error ? e.message : 'Errore'); }
    finally { setSalvaConfig(false); }
  }

  const voci: [string, [Vista, number | null][]][] = [
    ['Operatività', [['cruscotto', null], ['societa', conta.societa], ['spedire', conta.spedire], ['monitorare', conta.monitorare]]],
    ['Controllo',   [['dati', conta.dati], ['alert', conta.alert], ['ticket', conta.ticket]]],
    ['Impostazioni', [['config', null]]]
  ];

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand"><b>CHECKPOINT</b><span>Cruscotto spedizioni</span></div>
        {voci.map(([sez, items]) => (
          <div key={sez}>
            <div className="nav-sec">{sez}</div>
            {items.map(([v, n]) => (
              <button key={v} className={`item ${vista === v ? 'on' : ''}`} onClick={() => setVista(v)}>
                <span aria-hidden>{VISTE[v].icona}</span>{VISTE[v].titolo}
                {n !== null && <span className={`n ${v === 'alert' && conta.critici ? 'crit' : v === 'dati' && n ? 'warn' : ''}`}>{n}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="nav-foot">
          Ordini non consegnati dal {dataInizio ?? '…'}<br />
          {caricatoIl ? `Dati aggiornati alle ${new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(caricatoIl))}` : 'Caricamento…'}
          <br /><button className="btn" style={{ marginTop: 8 }} onClick={() => carica(true)}>Aggiorna ora</button>
        </div>
      </nav>

      <div className="main">
        <header className="top">
          <div>
            <h1>{VISTE[vista].titolo}</h1>
            <div className="sub">{VISTE[vista].sottotitolo}</div>
          </div>
          <div className="search">
            <input type="search" value={ricerca} onChange={e => setRicerca(e.target.value)}
              placeholder="Ordine, cliente, tracking, società…" />
          </div>
        </header>

        <div className="wrap">
          {stato === 'carico' && <div className="caricamento">Caricamento degli ordini da Shopify…</div>}
          {stato === 'errore' && (
            <div className="banner crit">
              {errore}
              <div style={{ marginTop: 8 }}><button className="btn" onClick={() => carica(true)}>Riprova</button></div>
            </div>
          )}
          {typeof window !== 'undefined'
            && !document.querySelector('meta[name="shopify-api-key"]')?.getAttribute('content') && (
            <div className="banner crit">
              <b>Configurazione incompleta.</b> La variabile <code>NEXT_PUBLIC_SHOPIFY_CLIENT_ID</code>
              {' '}era vuota al momento della build, quindi App Bridge non pu&ograve; inizializzarsi e
              nessuna schermata pu&ograve; caricare dati. Impostarla su Vercel come variabile
              {' '}<b>non sensitive</b> e rideployare.
            </div>
          )}
          {troncato && (
            <div className="banner warn">
              Il perimetro ha superato il limite di pagine: alcuni ordini più vecchi non sono stati caricati.
              Restringere la finestra temporale.
            </div>
          )}

          {stato === 'pronto' && (
            <>
              {vista === 'cruscotto' && <Cruscotto ordini={filtrati} config={config} vai={vaiA} apri={setAperto} />}
              {vista === 'spedire' && <DaSpedire ordini={filtrati} oggi={oggiRoma()} filtri={f} imposta={setF}
                azzera={azzeraF} rapido={rapido} setRapido={setRapido} apri={setAperto} opzioni={opzioni} />}
              {vista === 'monitorare' && <DaMonitorare ordini={filtrati} config={config} filtri={f} imposta={setF}
                azzera={azzeraF} rapido={rapido} setRapido={setRapido} apri={setAperto} opzioni={opzioni} />}
              {vista === 'dati' && <AlertDati ordini={filtrati} rapido={rapido} setRapido={setRapido} apri={setAperto} />}
              {vista === 'alert' && <AlertSpedizione ordini={filtrati} rapido={rapido} setRapido={setRapido} apri={setAperto} />}
              {vista === 'ticket' && <TicketScreen ordini={filtrati} rapido={rapido} setRapido={setRapido} apri={setAperto} />}
              {vista === 'config' && <Configurazione config={config} salva={salvaConfigurazione} inCorso={salvaConfig} />}
              {vista === 'societa' && <Societa ordini={filtrati} config={config} filtri={f} imposta={setF}
                azzera={azzeraF} aperti={espansi} apri={setAperto} opzioni={opzioni}
                alterna={k => setEspansi(e => ({ ...e, [k]: !e[k] }))} />}
            </>
          )}
        </div>
      </div>

      {aperto && <Dettaglio id={aperto} chiudi={() => setAperto(null)} aggiornato={() => carica(true)} />}
    </div>
  );
}
