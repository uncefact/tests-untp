'use client';

import { notFound } from 'next/navigation';
import appConfig from '../../../constants/app-config.json';
import Application from '../../../components/Application';
import { convertStringToPath } from '../../../utils';
import { use } from 'react';
import { IApp } from '@/types/common.types';

interface AppPageProps {
  params: Promise<{
    app: string;
  }>;
}

export default function AppPage({ params }: AppPageProps) {
  const { app: appSlug } = use(params);

  const foundApp = appConfig.apps.find((configApp) => convertStringToPath(configApp.name) === appSlug);

  const foundGeneralFeature = appConfig.generalFeatures.find(
    (feature) => convertStringToPath(feature.name) === appSlug,
  );

  const app = foundApp || foundGeneralFeature;

  if (!app) {
    notFound();
  }

  return <Application app={app as unknown as IApp} />;
}
