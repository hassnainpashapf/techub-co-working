"use client";

import { useEffect } from 'react';
import './globals.css';
import { AuthProvider } from '../context/AuthContext';
import PwaInstall from '../components/PwaInstall';
import IosInstallGuide from '../components/IosInstallGuide';

export default function RootLayout({ children }) {
  // Register service worker (production only) — force update check so new
  // deploys replace stale cached assets automatically.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.update().catch(() => {});
        reg.onupdatefound = () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.onstatechange = () => {
            if (worker.state === 'activated' && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          };
        };
      }).catch(() => {});
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <title>Techub Co-Working</title>
        <link rel="icon" type="image/png" href="/techub-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0f766e" />
        <link rel="apple-touch-icon" href="/techub-icon.png" />
        <meta name="apple-mobile-web-app-title" content="Techub" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <PwaInstall />
        <IosInstallGuide />
      </body>
    </html>
  );
}
