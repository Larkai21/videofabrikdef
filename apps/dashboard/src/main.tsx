import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ChannelProvider } from './lib/channel';
import { EventsProvider } from './lib/events';
import { SearchProvider } from './lib/search';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toasts';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (container === null) throw new Error('Falta el elemento #root');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <EventsProvider>
            <ChannelProvider>
              <BrowserRouter>
                <SearchProvider>
                  <App />
                </SearchProvider>
              </BrowserRouter>
            </ChannelProvider>
          </EventsProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
