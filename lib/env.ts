/**
 * Accesso alle variabili d'ambiente.
 * Regola ferma: nessun valore di segreto viene mai loggato o restituito da un'API.
 * Le diagnostiche espongono soltanto i NOMI delle variabili e se sono valorizzate.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

export const env = {
  get shop() { return required('SHOPIFY_SHOP'); },
  get clientId() { return required('SHOPIFY_CLIENT_ID'); },
  get clientSecret() { return required('SHOPIFY_CLIENT_SECRET'); },
  get apiVersion() { return process.env.SHOPIFY_API_VERSION || '2026-07'; },
  get allowedShops(): string[] {
    const extra = (process.env.SHOPIFY_ALLOWED_SHOPS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    return [required('SHOPIFY_SHOP'), ...extra];
  }
};

/** Elenco dei nomi presenti/assenti, per l'endpoint di diagnostica. Mai i valori. */
export function envStatus() {
  const nomi = ['SHOPIFY_SHOP', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET',
                'SHOPIFY_API_VERSION', 'NEXT_PUBLIC_SHOPIFY_CLIENT_ID'];
  return Object.fromEntries(nomi.map(n => [n, Boolean(process.env[n])]));
}
