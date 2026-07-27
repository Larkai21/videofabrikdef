import { Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { Ajustes } from './screens/Ajustes';
import { Bandeja } from './screens/Bandeja';
import { Biblioteca } from './screens/Biblioteca';
import { Componentes } from './screens/Componentes';
import { Entrega } from './screens/Entrega';
import { Guion } from './screens/Guion';
import { Ideas } from './screens/Ideas';
import { Timeline } from './screens/Timeline';
import { Wizard } from './screens/Wizard';

export function App() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <AppHeader />
      <Routes>
        <Route path="/" element={<Bandeja />} />
        <Route path="/wizard" element={<Wizard />} />
        <Route path="/ideas" element={<Ideas />} />
        <Route path="/videos/:id/guion" element={<Guion />} />
        <Route path="/videos/:id/timeline" element={<Timeline />} />
        <Route path="/videos/:id/entrega" element={<Entrega />} />
        <Route path="/biblioteca" element={<Biblioteca />} />
        <Route path="/componentes" element={<Componentes />} />
        <Route path="/ajustes" element={<Ajustes />} />
      </Routes>
    </div>
  );
}
