import React from 'react';
import { Route, Routes } from 'react-router-dom';
import appConfig from '../../constants/app-config.json';
import { Form, Home } from '../../pages';
import { IApp } from '../../pages/Home';
import { convertStringToPath } from '../../utils';

function Router() {
  return (
    <Routes>
      <Route path='/' element={<Home />} />,
      {appConfig.apps.map((app: IApp) => {
        const mainPath = `/${convertStringToPath(app.name)}`;
        const mainElement = <Home app={app} />;

        const childRoutes = app.features.map((feature) => {
          const childPath = `/${convertStringToPath(feature.name)}`;
          const childElement = <Form feature={feature} />;

          const combinePath = `${mainPath}${childPath}`;
          return <Route key={combinePath} path={combinePath} element={childElement} />;
        });

        return (
          <Route key={mainPath} path={mainPath} element={mainElement}>
            {childRoutes}
          </Route>
        );
      })}
    </Routes>
  );
}

export default Router;
