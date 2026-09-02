import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cruscotto spedizioni — Checkpoint',
  description: 'Gestione operativa delle spedizioni',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID ?? '';
  return (
    <html lang="it">
      <head>
        {/*
          App Bridge va incluso come tag <script> GREZZO e SINCRONO.
          Verificato in console sullo store il 01/09:

            "Shopify's App Bridge must be included as the first <script> tag and
             must link to Shopify's CDN. Do not use async, defer or type=module.
             Aborting."

          Quindi niente `async` e niente next/script: la strategia
          `beforeInteractive` aggiunge comunque `async` e App Bridge aborta.
          Questo tag deve restare cosi' com'e'. Non "ottimizzarlo".
        */}
        <meta name="shopify-api-key" content={clientId} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        {!clientId && (
          <script
            dangerouslySetInnerHTML={{ __html:
              "console.error('CONFIGURAZIONE: NEXT_PUBLIC_SHOPIFY_CLIENT_ID era vuota al momento della "
              + "build. App Bridge non puo\\u2019 inizializzarsi. Su Vercel la variabile deve essere di "
              + "tipo Config, non Secret: il prefisso NEXT_PUBLIC_ la espone comunque al browser.');" }}
          />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
