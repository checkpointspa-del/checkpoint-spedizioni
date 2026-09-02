'use client';
import type { Config } from '@/lib/config';
import { PRESA_IN_CARICO } from '@/lib/status';

const ETICHETTE_SOGLIE: Record<keyof Config['soglie'], string> = {
  oreSenzaEventoDopoTracking: 'Ore senza eventi dopo la creazione del tracking',
  giorniColloNonPartitoUrgente: 'Giorni senza alcun evento \u2192 collo non partito, urgente',
  giorniColloNonPartitoCritico: 'Giorni senza alcun evento \u2192 collo non partito, critico',
  oreMancataPresaInCarico: 'Ore per considerare mancata la presa in carico',
  oreTrackingFermo: 'Ore di tracking fermo → attenzione',
  oreTrackingFermoCritico: 'Ore di tracking fermo → urgente',
  giorniOltreFinestra: 'Giorni lavorativi oltre la finestra prima dell’alert',
  giorniPossibileSmarrimento: 'Giorni fermo → possibile smarrimento',
  oreScadenzaImminente: 'Ore per “prossima alla scadenza”'
};

export default function Configurazione(
  { config, salva, inCorso }:
  { config: Config; salva: (c: Config) => void; inCorso: boolean }
) {
  const cambia = (patch: Partial<Config>) => salva({ ...config, ...patch });

  return (
    <>
      <div className="active-note">
        La configurazione è salvata su un metafield dell’installazione dell’app, quindi vive dentro Shopify ed è modificabile
        senza rideploy. I valori valgono per tutte le schermate.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 12 }}>
        <div className="card">
          <h2>Perimetro <span className="right">day 1 del cruscotto</span></h2>
          <div className="pad">
            <div className="row" style={{ padding: '6px 0' }}>
              <span style={{ flex: 1, fontSize: 12.8 }}>Gli ordini creati prima di questa data non entrano</span>
              <input type="date" value={config.dataInizio}
                onChange={e => cambia({ dataInizio: e.target.value })} />
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              Data fissa, non finestra mobile: il perimetro non slitta da solo. Attenzione però —
              senza lo scope <b>read_all_orders</b> Shopify restituisce solo gli ultimi 60 giorni e lo fa
              in silenzio. Quando questa data invecchia oltre i 60 giorni il cruscotto lo dichiara, ma
              conviene spostarla prima.
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Finestre di consegna <span className="right">giorni lavorativi dalla presa in carico</span></h2>
          <div className="pad">
            {Object.entries(config.finestre).map(([k, f]) => (
              <div key={k} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ flex: 1 }}>{f.label}</span>
                <input type="number" min={0} value={f.min} style={{ width: 56, textAlign: 'center' }}
                  onChange={e => cambia({ finestre: { ...config.finestre, [k]: { ...f, min: Number(e.target.value) } } as Config['finestre'] })} />
                <span className="muted">–</span>
                <input type="number" min={0} value={f.max} style={{ width: 56, textAlign: 'center' }}
                  onChange={e => cambia({ finestre: { ...config.finestre, [k]: { ...f, max: Number(e.target.value) } } as Config['finestre'] })} />
                <span className="muted small">gg</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Soglie degli alert di spedizione</h2>
          <div className="pad">
            {(Object.keys(config.soglie) as (keyof Config['soglie'])[]).map(k => (
              <div key={k} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ flex: 1, fontSize: 12.8 }}>{ETICHETTE_SOGLIE[k]}</span>
                <input type="number" min={0} value={config.soglie[k]} style={{ width: 64, textAlign: 'center' }}
                  onChange={e => cambia({ soglie: { ...config.soglie, [k]: Number(e.target.value) } })} />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Eventi di uscita dal magazzino</h2>
          <div className="pad">
            <div className="tagbox">{PRESA_IN_CARICO.map(s => <span key={s} className="tag">{s}</span>)}</div>
            <div className="small muted" style={{ marginTop: 8 }}>
              Sono gli stati dei fulfillment event di Shopify che provano l’uscita fisica del collo.
              <b> CONFIRMED</b>, <b>LABEL_PURCHASED</b> e <b>LABEL_PRINTED</b> sono volutamente esclusi: la creazione
              della LDV non è una presa in carico. Anche <b>DELAYED</b> è escluso perché può comparire prima del ritiro.
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Calendario festività <span className="right">Europe/Rome</span></h2>
          <div className="pad"><div className="tagbox">
            {config.festivi.map(f => <span key={f} className="tag">{f}</span>)}
          </div></div>
        </div>
      </div>
      {inCorso && <div className="banner warn" style={{ marginTop: 12 }}>Salvataggio in corso…</div>}
    </>
  );
}
