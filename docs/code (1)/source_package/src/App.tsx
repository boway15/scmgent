import { BrowserRouter } from 'react-router-dom';
import { appBasePath } from '@/lib/base-path';
import { AppRouter } from './router';

const basename = appBasePath() || undefined;

export default function App() {
  return (
    <BrowserRouter basename={basename || undefined}>
      <AppRouter />
    </BrowserRouter>
  );
}
