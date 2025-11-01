'use client';

import { notFound } from 'next/navigation';
import appConfig from '@/constants/app-config.json';
import GenericPage from '@/components/GenericPage';
import { convertStringToPath } from '@/utils';
import { IDynamicComponentRendererProps } from '@mock-app/components';
import { use } from 'react';

interface FeaturePageProps {
  params: Promise<{
    app: string;
    feature: string;
  }>;
}

export default function FeaturePage({ params }: FeaturePageProps) {
  const { app: appSlug, feature: featureSlug } = use(params);

  const foundApp = appConfig.apps.find((configApp) => convertStringToPath(configApp.name) === appSlug);

  const foundGeneralFeature = appConfig.generalFeatures.find(
    (generalFeature) => convertStringToPath(generalFeature.name) === appSlug,
  );

  const app = foundApp || foundGeneralFeature;

  if (!app) {
    notFound();
  }

  const feature = app.features.find((f) => convertStringToPath(f.name) === featureSlug);

  if (!feature) {
    notFound();
  }

  return (
    <GenericPage componentsData={feature.components as IDynamicComponentRendererProps[]} services={feature.services} />
  );
}
