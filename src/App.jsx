import { HashRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import PlannerPage from './pages/PlannerPage.jsx';
import { AuthProvider } from './context/AuthContext.jsx';

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/planner/:eventId" element={<PlannerPage />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
