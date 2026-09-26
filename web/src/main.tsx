import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { BASE, ExplorerProvider, Link, normalizeAddress, RouterProvider, useExplorer, useRoute } from './lib';
import Overview from './pages/Overview';
import Leaderboard from './pages/Leaderboard';
import Markets from './pages/Markets';
import Market from './pages/Market';
import Wallet from './pages/Wallet';
import About from './pages/About';

function Search() {
  const { go } = useRoute();
  const [q, setQ] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <form
      className="nav-search"
      onSubmit={(e) => {
        e.preventDefault();
        const a = normalizeAddress(q);
        if (!a) return setBad(true);
        setBad(false);
        setQ('');
        go(`/wallet/${a}`);
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.6" />
        <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setBad(false);
        }}
        placeholder="Look up any wallet (0x…)"
        aria-label="Wallet address"
        spellCheck={false}
        style={bad ? { boxShadow: '0 0 0 2px var(--neg)' } : undefined}
      />
    </form>
  );
}

function Nav() {
  const { path } = useRoute();
  const is = (p: string) => (p === '/' ? path === '/' : path.startsWith(p)) ? 'active' : '';
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand">
          <img src={`${BASE}favicon.svg`} alt="" />
          Predict Stats
        </Link>
        <div className="nav-links">
          <Link to="/" className={is('/')}>Overview</Link>
          <Link to="/leaderboard" className={is('/leaderboard')}>Leaderboard</Link>
          <Link to="/markets" className={is('/market')}>Markets</Link>
          <Link to="/about" className={is('/about')}>How it works</Link>
        </div>
        <Search />
      </div>
    </nav>
  );
}

function Footer() {
  const ex = useExplorer();
  return (
    <footer>
      <div>
        Community-built, read-only stats for DeepBook Predict on Sui. Computed from public on-chain events.
        <br />
        Not affiliated with Mysten Labs or DeepBook. Not financial advice.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        Explorer
        <div className="segmented">
          <button className={ex.explorer === 'suivision' ? 'on' : ''} onClick={() => ex.setExplorer('suivision')}>
            SuiVision
          </button>
          <button className={ex.explorer === 'suiscan' ? 'on' : ''} onClick={() => ex.setExplorer('suiscan')}>
            Suiscan
          </button>
        </div>
      </div>
    </footer>
  );
}

function Routes() {
  const { path } = useRoute();
  const p = path.split('?')[0]!;
  let page;
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/wallet\/([^/]+)/))) page = <Wallet key={m[1]} address={decodeURIComponent(m[1]!)} />;
  else if ((m = p.match(/^\/market\/([^/]+)/))) page = <Market key={m[1]} id={decodeURIComponent(m[1]!)} />;
  else if (p === '/leaderboard') page = <Leaderboard />;
  else if (p === '/markets') page = <Markets />;
  else if (p === '/about') page = <About />;
  else if (p === '/') page = <Overview />;
  else
    page = (
      <div className="page-head">
        <h1>Not found</h1>
        <p>
          <Link to="/">Back to the overview ›</Link>
        </p>
      </div>
    );
  return <main>{page}</main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <ExplorerProvider>
        <Nav />
        <Routes />
        <Footer />
      </ExplorerProvider>
    </RouterProvider>
  </StrictMode>,
);
