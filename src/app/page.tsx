'use client';

import { Providers } from '@/components/dashboard/providers';
import { Dashboard } from '@/components/dashboard/dashboard';

export default function Home() {
  return (
    <Providers>
      <Dashboard />
    </Providers>
  );
}
