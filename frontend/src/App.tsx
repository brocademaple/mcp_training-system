import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import DatasetManagement from '@/pages/Dataset';
import TrainingManagement from '@/pages/Training';
import ModelManagement from '@/pages/Model';
import EvaluationManagement from '@/pages/Evaluation';
import AgentCanvas from '@/pages/AgentCanvas';
import PipelinesPage from '@/pages/Pipelines';
import './transition.css';

const App: React.FC = () => {
  const [versionMode, setVersionMode] = useState(localStorage.getItem('app-version') || 'classic');
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const handleStorageChange = () => {
      const newMode = localStorage.getItem('app-version') || 'classic';
      if (newMode !== versionMode) {
        setIsTransitioning(true);
        setTimeout(() => {
          setVersionMode(newMode);
          setTimeout(() => setIsTransitioning(false), 50);
        }, 300);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [versionMode]);

  return (
    <BrowserRouter>
      <div className={`app-container ${isTransitioning ? 'transitioning' : ''}`}>
        <Routes>
          {versionMode === 'agent' ? (
            <>
              <Route path="/" element={<AgentCanvas />} />
              <Route path="/pipeline" element={<Navigate to="/pipelines" replace />} />
              <Route path="/datasets" element={<Layout />}>
                <Route index element={<DatasetManagement />} />
              </Route>
              <Route path="/pipelines" element={<Layout />}>
                <Route index element={<PipelinesPage />} />
              </Route>
            </>
          ) : (
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="datasets" element={<DatasetManagement />} />
              <Route path="training" element={<TrainingManagement />} />
              <Route path="models" element={<ModelManagement />} />
              <Route path="evaluation" element={<EvaluationManagement />} />
              <Route path="pipeline" element={<Navigate to="/pipelines" replace />} />
              <Route path="pipelines" element={<PipelinesPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          )}
        </Routes>
      </div>
    </BrowserRouter>
  );
};

export default App;
