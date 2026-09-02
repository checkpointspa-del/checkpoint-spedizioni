'use client';
import { useEffect, useState } from 'react';
import type { OrdineApp } from '@/lib/classify';
import { STATI, statoDaEvento } from '@/lib/status';
import { STATI_TICKET, StatoTicket, CAUSE_DATI, CAUSE_SPEDIZIONE } from '@/lib/alerts';
import { api } from '@/lib/client';
import { Badge, GruppoBadge, StatoBadge, D, DT, trascorso, ND, BADGE_GRAVITA, TicketBadge } from '../ui';

type Scheda = 'dettaglio' | 'cronologia' | 'ticket';

export default function Dettaglio(
  { id, chiudi, aggiornato }:
  { id: string; chiudi: () => void; aggiornato: () => void }
) {
  const [o, setO] = useState<OrdineApp | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [scheda, setScheda] = useState<Scheda>('dettaglio');
  const [salvataggio, setSalvataggio] = useState(false);

  useEffect(() => {
    let vivo = true;
    setO(null); setErrore(null);
    api<{ ordine: OrdineApp }>(`/api/ordini/${encodeURIComponent(id)}`)
      .then(r => { if (vivo) setO(r.ordine); })
      .catch(e => { if (vivo) setErrore(e.message); });
    return () => { vivo = false; };
  }, [id]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [chiudi]);

  async function cambiaTicket(stato: StatoTicket) {
    if (!o) return;
    setSalvataggio(true);
    try {
      await api('/api/ticket', { method: 'POST', body: JSON.stringify({ ordineId: o.id, stato }) });
      const r = await api<{ ordine: OrdineApp }>(`/api/ordini/${encodeURIComponent(o.id)}`);
      setO(r.ordine);
      aggiornato();
    } catch (e) { setErrore(e instanceof Error ? e.message : 'Errore'); }
    finally { setSalvataggio(false); }
  }

  return (
    <>
      <div className="scrim" onClick={chiudi} />
      <aside className="drawer">
        {!o && !errore && <div className="caricamento">Caricamento dell’ordine…</div>}
        {errore && <div className="pad"><div className="banner crit">{errore}</div>
          <button className="btn" onClick={chiudi}>Chiudi</button></div>}
        {o && (
          <>
            <div className="dhead">
              <div className="t">
                <h3>{o.nome}</h3>
                <GruppoBadge o={o} /><StatoBadge o={o} />
                {o.alertSpedizione.length ? <Badge tipo={BADGE_GRAVITA[o.gravitaSpedizione!]}>{o.alertSpedizione.length} alert spedizione</Badge> : null}
                {o.alertDati.length ? <Badge tipo="warn">{o.alertDati.length} alert dati</Badge> : null}
                <button className="x" onClick={chiudi} aria-label="Chiudi">×</button>
              </div>
              <div className="small muted" style={{ marginTop: 5 }}>
                {o.cliente} · {o.destinazione.citta} ({o.destinazione.provincia}), {o.destinazione.regione} — {o.destinazione.paese}
              </div>
            </div>

            <div className="tabs">
              {(['dettaglio', 'cronologia', 'ticket'] as Scheda[]).map(s => (
                <button key={s} className={scheda === s ? 'on' : ''} onClick={() => setScheda(s)}>
                  {s === 'dettaglio' ? 'Dettaglio' : s === 'cronologia' ? 'Cronologia' : 'Ticket'}
                </button>
              ))}
            </div>

            <div className="dbody">
              {scheda === 'dettaglio' && <SchedaDettaglio o={o} />}
              {scheda === 'cronologia' && <SchedaCronologia o={o} />}
              {scheda === 'ticket' && (
                <SchedaTicket o={o} cambia={cambiaTicket} inCorso={salvataggio} />
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function SchedaDettaglio({ o }: { o: OrdineApp }) {
  return (
    <>
      <div className="card"><h2>Ordine e spedizione</h2><div className="pad"><div className="kv">
        <div><span>Data ordine</span><b>{DT(o.ricezione)}</b></div>
        <div><span>Cliente</span><b>{o.cliente}</b></div>
        <div><span>Società</span><b>{o.isB2B ? 'B2B (nessun tag società)' : o.socNome}</b></div>
        <div><span>Categoria</span><b>{o.categoria}</b></div>
        <div><span>Atleta</span><b>{o.atleta}</b></div>
        <div><span>Articoli</span><b>{o.articoli}</b></div>
        <div><span>Zona / finestra</span><b>{o.zona} — vedi configurazione</b></div>
        <div><span>Corriere</span><b>{o.corriere ?? '—'}</b></div>
        <div><span>Tracking</span><b className="tr-code">{o.tracking ?? '—'}</b></div>
        <div><span>Fase di ritiro</span><b>{o.faseRitiro}</b></div>
        <div><span>Spedizione prevista</span><b>{o.prevista ? D(o.prevista) : <span style={{ color: 'var(--crit)' }}>assente</span>}</b></div>
        <div><span>Uscita dal magazzino</span><b>{o.presaAt ? DT(o.presaAt) : 'non ancora registrata'}
          {o.presaApprossimata && <> <Badge tipo="warn">stimata</Badge></>}</b></div>
        <div><span>Consegna stimata</span><b>{o.etaMax ? `${D(o.etaMin)} – ${D(o.etaMax)}` : '—'}</b></div>
        <div><span>Ritardo</span><b>{o.ritardoGG ? `+${o.ritardoGG} giorni lavorativi` : 'nessuno'}</b></div>
        <div><span>Ultimo aggiornamento</span><b>{trascorso(o.ultimoEventoAt)}</b></div>
        <div><span>Consegnata il</span><b>{o.consegnaUltima ? DT(o.consegnaUltima) : '—'}</b></div>
      </div></div></div>

      <div className="card" style={{ marginTop: 12 }}><h2>Tempi operativi</h2><div className="pad"><div className="kv">
        <div><span>Ricezione ordine</span><b>{DT(o.ricezione)}</b></div>
        <div><span>Tracking creato</span><b>{o.trackAt ? DT(o.trackAt) : ND}</b></div>
        <div><span>Presa in carico effettiva</span><b>{o.presaAt ? DT(o.presaAt) : ND}
          {o.presaApprossimata && <> <Badge tipo="warn">stimata</Badge></>}</b></div>
        <div><span>In attesa di ritiro da</span><b>{o.oreAttesaRitiro == null ? '—'
          : `${Math.round(o.oreAttesaRitiro)} h`}</b></div>
        <div><span>Ultimo aggiornamento</span><b>{trascorso(o.ultimoEventoAt)}</b></div>
        <div><span>Consegna stimata</span><b>{o.etaMax ? `${D(o.etaMin)} – ${D(o.etaMax)}` : '—'}</b></div>
      </div>
      <div className="sep" />
      <div className="small muted">
        Sono i tempi che servono a decidere se intervenire. Le statistiche sulle prestazioni
        sono fuori dal perimetro di questa versione.
        {o.presaApprossimata && (
          <> <b style={{ color: 'var(--warn)' }}>Il corriere non ha notificato il ritiro:</b> la data di
          presa in carico è dedotta dal primo evento successivo, quindi la finestra di consegna
          parte più tardi del reale.</>
        )}
      </div></div></div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Tag ordine <span className="right">sola lettura</span></h2>
        <div className="pad">
          <div className="tagbox">
            {o.tags.length ? o.tags.map(t => {
              const cattivo = t === 'alert' || (t.startsWith('spedizione_prevista=') && !/^\d{4}-\d{2}-\d{2}$/.test(t.split('=')[1] ?? ''));
              return <span key={t} className={`tag ${cattivo ? 'bad' : ''}`}>{t}</span>;
            }) : <span className="muted small">Nessun tag — ordine classificato B2B.</span>}
          </div>
          <div className="small muted" style={{ marginTop: 9 }}>
            L’app distingue il <b>tag sorgente</b> <code>alert</code> dall’<b>alert applicativo</b> calcolato,
            e non scrive alcun tag sulla piattaforma.
          </div>
        </div>
      </div>

      {(o.alertDati.length > 0) && (
        <div className="card" style={{ marginTop: 12 }}><h2>⚑ Alert dati</h2><div className="pad">
          {o.alertDati.map(c => (
            <div key={c} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <Badge tipo={BADGE_GRAVITA[CAUSE_DATI[c].gravita]}>{CAUSE_DATI[c].gravita}</Badge> <b>{CAUSE_DATI[c].label}</b>
              <div className="small muted" style={{ marginTop: 3 }}>{CAUSE_DATI[c].azione}</div>
            </div>
          ))}
        </div></div>
      )}

      {(o.alertSpedizione.length > 0) && (
        <div className="card" style={{ marginTop: 12 }}><h2>▲ Alert spedizione</h2><div className="pad">
          {o.alertSpedizione.map(a => (
            <div key={a.causa} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <Badge tipo={BADGE_GRAVITA[a.gravita]}>{a.gravita}</Badge> <b>{CAUSE_SPEDIZIONE[a.causa].label}</b>
              <div className="small muted" style={{ marginTop: 3 }}>{CAUSE_SPEDIZIONE[a.causa].azione}</div>
            </div>
          ))}
        </div></div>
      )}
    </>
  );
}

function SchedaCronologia({ o }: { o: OrdineApp }) {
  return (
    <>
      {!o.snapshotPresente && (
        <div className="banner warn">
          Riassunto non presente su questo ordine: le tappe sono state ricalcolate al momento dagli eventi.
          Nessun evento è stato ricostruito o stimato.
        </div>
      )}
      {o.spedizioni.map((s, i) => (
        <div className="card" key={s.fulfillmentId} style={{ marginBottom: 12 }}>
          <h2>Spedizione {i + 1} di {o.spedizioni.length}
            <span className="right">{s.corriere ?? 'corriere non indicato'} · {s.tracking ?? 'nessun tracking'}</span></h2>
          <div className="pad">
            {!s.eventi?.length && <div className="empty">Nessun evento registrato dal corriere. {ND}</div>}
            {!!s.eventi?.length && (
              <ul className="tl">
                {[...s.eventi].reverse().map((e, idx) => {
                  const st = statoDaEvento(e.status, e.message);
                  const anomalo = STATI[st]?.genere === 'alt';
                  return (
                    <li key={e.id} className={[idx === 0 && 'now', anomalo && 'exc'].filter(Boolean).join(' ')}>
                      <div className="when">{DT(e.happenedAt)} · {trascorso(e.happenedAt)}</div>
                      <div className="what">{e.message || STATI[st]?.label}</div>
                      <div className="where">
                        {[e.city, e.province, e.country].filter(Boolean).join(', ') || '—'}
                        {' · '}stato Shopify <span className="tr-code">{e.status}</span> → {STATI[st]?.label ?? 'non mappato'}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="sep" />
            <div className="kv">
              <div><span>Tracking creato</span><b>{s.trackAt ? DT(s.trackAt) : ND}</b></div>
              <div><span>Presa in carico effettiva</span><b>{s.presaAt ? DT(s.presaAt) : ND}
                {s.presaApprossimata && <> <Badge tipo="warn">stimata</Badge></>}</b></div>
              <div><span>Consegna</span><b>{s.consegnaAt ? DT(s.consegnaAt) : ND}</b></div>
              <div><span>Eventi registrati</span><b>{s.numeroEventi}</b></div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function SchedaTicket(
  { o, cambia, inCorso }:
  { o: OrdineApp; cambia: (s: StatoTicket) => void; inCorso: boolean }
) {
  const t = o.ticket;
  if (!t) return <div className="empty">Nessuna anomalia: non è previsto alcun ticket per questa spedizione.</div>;
  return (
    <div className="card"><h2>Ticket corriere</h2><div className="pad">
      <div className="kv">
        <div><span>Stato</span><b><TicketBadge stato={t.stato} /></b></div>
        <div><span>Corriere</span><b>{t.corriere ?? o.corriere ?? '—'}</b></div>
        <div><span>Riferimento</span><b className="tr-code">{t.riferimento ?? '—'}</b></div>
        <div><span>Operatore</span><b>{t.operatore ?? '—'}</b></div>
        <div><span>Data apertura</span><b>{t.apertoIl ? DT(t.apertoIl) : '—'}</b></div>
        <div><span>Ultimo aggiornamento</span><b>{t.aggiornatoIl ? DT(t.aggiornatoIl) : '—'}</b></div>
        <div><span>Prossimo controllo</span><b>{t.prossimoControllo ? D(t.prossimoControllo) : '—'}</b></div>
        <div><span>Esito</span><b>{t.esito ?? '—'}</b></div>
      </div>
      <div className="sep" />
      <div className="small muted" style={{ marginBottom: 6 }}>Note</div>
      <div className="small">{t.note ?? 'Nessuna nota.'}</div>
      <div className="sep" />
      <div className="small muted" style={{ marginBottom: 6 }}>Cambia stato</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {(Object.keys(STATI_TICKET) as StatoTicket[]).map(k => (
          <button key={k} disabled={inCorso} className={`btn ${k === t.stato ? 'pri' : ''}`} onClick={() => cambia(k)}>
            {STATI_TICKET[k]}
          </button>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>
        Lo stato è salvato in un metafield dell’ordine. L’app non invia comunicazioni al corriere.
      </div>
    </div></div>
  );
}
