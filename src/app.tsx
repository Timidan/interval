import { StageProvider } from '@/components/stage';
import { ImportPage } from '@/pages/import-page';
import { Landing } from '@/pages/landing';
import { SheetPage } from '@/pages/sheet-page';

export function App() {
  const path = window.location.pathname;
  return <StageProvider>{path.startsWith('/sheet') ? <SheetPage /> : path.startsWith('/import') ? <ImportPage /> : <Landing />}</StageProvider>;
}
