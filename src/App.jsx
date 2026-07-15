import { HashRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import PlannerPage from './pages/PlannerPage.jsx';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/planner/:eventId" element={<PlannerPage />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
