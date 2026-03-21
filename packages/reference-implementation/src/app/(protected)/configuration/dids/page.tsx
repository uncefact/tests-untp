'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@reference-implementation/components';

export default function DidsPage() {
  return (
    <div data-testid='dids-page'>
      <h1 className='text-2xl font-semibold mb-6'>DIDs (Decentralised Identifiers)</h1>

      <Tabs defaultValue='managed'>
        <TabsList className='bg-muted/50 p-1'>
          <TabsTrigger value='managed'>Managed</TabsTrigger>
          <TabsTrigger value='self-hosted'>Self hosted</TabsTrigger>
        </TabsList>

        <TabsContent value='managed' data-testid='managed-tab-content'>
          <div />
        </TabsContent>

        <TabsContent value='self-hosted' data-testid='self-hosted-tab-content'>
          <div />
        </TabsContent>
      </Tabs>
    </div>
  );
}
