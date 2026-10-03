'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Root (/) → send users to the login page.
// Client-side redirect so it works with the static export on Cloudflare Pages.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login');
  }, [router]);
  return null;
}
