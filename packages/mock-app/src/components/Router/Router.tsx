import React, { Fragment } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import appConfig from '../../constants/app-config.json';
import { Home, Scanning, Verify, Application, GenericPage } from '../../pages';
import { convertStringToPath } from '../../utils';
import { IFeature } from '../../types/common.types';

const renderRoutes = (app: any) => {
  const mainPath = `/${convertStringToPath(app.name)}`;
  const mainElement = <Application app={app} />;

  // Generate child routes for each feature of the app
  const childRoutes = app.features.map((feature: IFeature) => {
    const childPath = `/${convertStringToPath(feature.name)}`;
    const childElement = <GenericPage componentsData={feature.components} services={feature.services} />;

    // Create a React Router Route for the combined path, rendering the child element
    const combinePath = `${mainPath}${childPath}`;
    return <Route key={combinePath} path={combinePath} element={childElement} />;
  });

  // Create a React Router Route for the main path, rendering the main element and its child routes
  return (
    <Fragment key={mainPath}>
      <Route key={mainPath} path={mainPath} element={mainElement} />
      {childRoutes}
    </Fragment>
  );
};

function Router() {
  return (
    // Define the root routing container using React Router's Routes component
    <Routes>
      {/* Default route for the home page, rendering the Home component */}
      <Route path='/' element={<Home />} />,{/* Route for the Scanning page */}
      <Route path='/scanning' element={<Scanning />} />,{/* Route for the Verify page */}
      <Route path='/verify' element={<Verify />} />,
      {/* Catch-all route for any unknown paths, redirecting to the 404 page */}
      <Route path='*' element={<Navigate to='/404' />} />,
      {/* Iterate through the appConfig to dynamically generate routes */}
      {appConfig.apps.map(renderRoutes)}
      {appConfig.generalFeatures.map(renderRoutes)}
    </Routes>
  );
}

export default Router;
