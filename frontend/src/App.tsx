import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import DatasetManagement from '@/pages/Dataset';
import TrainingManagement from '@/pages/Training';
import ModelManagement from '@/pages/Model';
import EvaluationManagement from '@/pages/Evaluation';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="datasets" element={<DatasetManagement />} />
          <Route path="training" element={<TrainingManagement />} />
          <Route path="models" element={<ModelManagement />} />
          <Route path="evaluation" element={<EvaluationManagement />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
