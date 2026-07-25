import { HashRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import PlannerPage from './pages/PlannerPage.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { APIProvider } from '@vis.gl/react-google-maps';

function App() {
  return (
    <AuthProvider>
      <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyCi2P6D7Edbm45UHgm4q3psn8B3cCinRuM'}>
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/planner/:eventId" element={<PlannerPage />} />
          </Routes>
        </HashRouter>
      </APIProvider>
    </AuthProvider>
  );
}

export default App;
