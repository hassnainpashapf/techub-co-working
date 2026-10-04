// Server wrapper for static export (Cloudflare Pages).
// Dynamic params render client-side in page-client.js.
import { Suspense } from 'react';
import ClientPage from './page-client';
export async function generateStaticParams() { return [{ id: 'new' }]; }
export default function Page({ params }) {
  return (<Suspense fallback={null}><ClientPage params={params} /></Suspense>);
}
