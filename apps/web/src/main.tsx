import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Layout } from './components/Layout';
import { Home } from './screens/Home';
import { Create } from './screens/Create';
import { Join } from './screens/Join';
import { Table } from './screens/Table';
import './style.css';

function App() {
  const [path, code] = location.pathname.split('/').filter(Boolean);
  const screen = path === 'create' ? <Create /> : path === 'join' ? <Join initialCode={code} /> : path === 'room' && code ? <Table code={code.toUpperCase()} /> : <Home />;
  return <Layout>{screen}</Layout>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
