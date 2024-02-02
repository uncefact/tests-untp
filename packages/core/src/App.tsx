import React from 'react';
import GenericPage from './pages/GenericPage';
import './App.css';
import { componentsData, services } from './constant';

function App() {
  return (
    <div className='App'>
      <GenericPage componentsData={componentsData} services={services} />
    </div>
  );
}

export default App;
