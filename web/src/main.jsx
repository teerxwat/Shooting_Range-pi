import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from '@/shared/AppContext';
import '@/shared/index.css';

import KioskApp from '@/kiosk/App';
import CustomerApp from '@/customer/App';

// __APP__ ถูกกำหนดตอน build (vite.config.js): 'kiosk' | 'customer'
const App = __APP__ === 'customer' ? CustomerApp : KioskApp;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
