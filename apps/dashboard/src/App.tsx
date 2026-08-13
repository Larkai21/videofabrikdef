import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { LeyendaAtajos } from './components/LeyendaAtajos';
import { Ajustes } from './screens/Ajustes';
import { Bandeja } from './screens/Bandeja';
import { Biblioteca } from './screens/Biblioteca';
import { Componentes } from './screens/Componentes';
import { Costes } from './screens/Costes';
import { Entrega } from './screens/Entrega';
import { Guion } from './screens/Guion';
import { Ideas } from './screens/Ideas';
import { Shorts } from './screens/Shorts';
import { EpisodioClips } from './screens/EpisodioClips';
import { Episodios } from './screens/Episodios';
import { Plantillas } from './screens/Plantillas';
import { ReelDetalle } from './screens/ReelDetalle';
import { Reels } from './screens/Reels';
import { Timeline } from './screens/Timeline';
import { Wizard } from './screens/Wizard';

// Los ítems "En curso" y "Publicados" del nav son anclas (#en-curso, #publicados)
// sobre la misma página Bandeja. Sin esto el navegador no se desplaza y los tres
// parecen mostrar lo mismo. Reintenta unos ciclos porque la sección puede aún
// estar cargando datos cuando cambia la ruta.
function ScrollToHash() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash === '') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const id = hash.slice(1);
    let tries = 0;
    let raf = 0;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (tries++ < 20) raf = requestAnimationFrame(tryScroll);
    };
    tryScroll();
    return () => cancelAnimationFrame(raf);
  }, [pathname, hash]);
  return null;
}

export function App() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <AppHeader />
      {/* leyenda global: ? abre los atajos de la ruta actual, una sola
          instancia para toda la app */}
      <LeyendaAtajos />
      <ScrollToHash />
      <Routes>
        <Route path="/" element={<Bandeja />} />
        <Route path="/wizard" element={<Wizard />} />
        <Route path="/ideas" element={<Ideas />} />
        <Route path="/videos/:id/guion" element={<Guion />} />
        <Route path="/videos/:id/timeline" element={<Timeline />} />
        <Route path="/videos/:id/entrega" element={<Entrega />} />
        <Route path="/videos/:id/shorts" element={<Shorts />} />
        <Route path="/episodios" element={<Episodios />} />
        <Route path="/episodios/:id/clips" element={<EpisodioClips />} />
        {/* antes que /reels/:id: «plantillas» no es un id de reel */}
        <Route path="/reels/plantillas" element={<Plantillas />} />
        <Route path="/reels" element={<Reels />} />
        <Route path="/reels/:id" element={<ReelDetalle />} />
        <Route path="/biblioteca" element={<Biblioteca />} />
        <Route path="/componentes" element={<Componentes />} />
        <Route path="/costes" element={<Costes />} />
        <Route path="/ajustes" element={<Ajustes />} />
      </Routes>
    </div>
  );
}
