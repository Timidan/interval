import { Component, type ReactNode } from 'react';
import { buttonClass } from '@/components/button';
import { StageProvider } from '@/components/stage';
import { ImportPage } from '@/pages/import-page';
import { Landing } from '@/pages/landing';
import { SheetPage } from '@/pages/sheet-page';

/** A page that throws while rendering shows a way back instead of a blank screen. */
class PageError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-xl px-5 py-24">
        <h1 className="font-display text-[clamp(1.75rem,5vw,2.25rem)] font-extrabold uppercase leading-[1] text-chalk">This page hit an error</h1>
        <p className="mt-4 text-[0.9375rem] leading-[1.6] text-chalk-2">Reload to try again. If it keeps happening, start from the front page.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className={buttonClass('primary', 'h-12 px-5')}>Reload the page</button>
          <a href="/" className={buttonClass('ghost', 'h-12 px-5')}>Go to the front page</a>
        </div>
      </main>
    );
  }
}

export function App() {
  const path = window.location.pathname;
  return <StageProvider><PageError>{path.startsWith('/sheet') ? <SheetPage /> : path.startsWith('/import') ? <ImportPage /> : <Landing />}</PageError></StageProvider>;
}
