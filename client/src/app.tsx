

import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import ChangeOrderPage from './pages/ChangeOrderPage/ChangeOrderPage';
import DataExtractionPage from './pages/DataExtractionPage/DataExtractionPage';
import DrillPage from './pages/DrillPage/DrillPage';
import EventPage from './pages/EventPage/EventPage';
import InspectPage from './pages/InspectPage/InspectPage';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DataExtractionPage />} />
        <Route path="change" element={<ChangeOrderPage />} />
        <Route path="drill" element={<DrillPage />} />
        <Route path="event" element={<EventPage />} />
        <Route path="inspect" element={<InspectPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
