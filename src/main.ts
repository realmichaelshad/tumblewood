import './style.css';
import bricolageUrl from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url';
import figtreeUrl from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url';
import { App } from './app.ts';
import { decode, encode, kitOf, NOTES, PRICES, MARBLES_IN_KIT, type Board } from './board/board.ts';
import { starter } from './board/starter.ts';
import { ENAMEL } from './render/paint.ts';

declare global {
  interface Window {
    __step?: (ms: number) => void;
    __tumblewood?: App;
  }
}

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
const attract = params.get('attract') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function fonts(): Promise<void> {
  const faces = [
    new FontFace('Bricolage Grotesque Variable', `url(${bricolageUrl}) format('woff2')`, { weight: '200 800', display: 'swap' }),
    new FontFace('Figtree Variable', `url(${figtreeUrl}) format('woff2')`, { weight: '300 900', display: 'swap' }),
  ];
  for (const f of faces) document.fonts.add(f);
  await Promise.race([Promise.all(faces.map((f) => f.load())), new Promise((r) => setTimeout(r, 2500))]).catch(() => undefined);
}

function initialBoard(): Board {
  if (attract) return starter();
  const code = params.get('run');
  return (code && decode(code)) || starter();
}

const money = (n: number) => `$${n}`;

function renderKit(b: Board): void {
  const k = kitOf(b);
  const list = $<HTMLUListElement>('kit-list');
  const chips = k.notes.map((n) => `<span class="chip" style="background:${ENAMEL[n]}" title="${NOTES[n].color}"></span>`).join('');
  const names = (() => {
    const seen = k.notes.map((n) => NOTES[n].color);
    return seen.length ? seen.join(', ') : 'none yet';
  })();
  const row = (what: string, detail: string, price: string, zero = false, extra = '') =>
    `<li class="${zero ? 'zero' : ''}"><span class="what">${what}</span><span class="price">${price}</span><span class="detail">${detail}${extra}</span></li>`;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  list.innerHTML = [
    row('Pegboard and catch tray', `Birch board, drop cup, catch tray and a bag of ${MARBLES_IN_KIT} glass marbles`, money(PRICES.base)),
    row(plural(k.ramps, 'ramp', 'ramps'), `Solid beech with a drop slot, ${money(PRICES.ramp)} each`, money(k.ramps * PRICES.ramp), k.ramps === 0),
    row(plural(k.chimes, 'chime', 'chimes'), `Tuned aluminum: ${names}. ${money(PRICES.chime)} each`, money(k.chimes * PRICES.chime), k.chimes === 0, k.chimes ? `<span class="chips">${chips}</span>` : ''),
    row(plural(k.bells, 'brass bell', 'brass bells'), `Cast brass on a peg hook, ${money(PRICES.bell)} each`, money(k.bells * PRICES.bell), k.bells === 0),
    row(plural(k.pegs, 'beech peg', 'beech pegs'), 'Exactly what your run uses', 'Included', k.pegs === 0),
  ].join('');
  $('kit-total').textContent = money(k.total);
  $('order-sum').innerHTML = `${plural(k.ramps, 'ramp', 'ramps')}, ${plural(k.chimes, 'chime', 'chimes')} and ${plural(k.bells, 'bell', 'bells')} on a birch pegboard, set up the way you built it: <strong>${money(k.total)}</strong>.`;
  $('order-done').hidden = true;
}

function syncUrl(b: Board): void {
  if (capture) return;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('run', encode(b));
  try { history.replaceState(null, '', url); } catch { /* sandboxed frames may refuse; the run still works */ }
}

async function boot(): Promise<void> {
  if (attract) document.body.classList.add('attract');
  await fonts();
  const canvas = $<HTMLCanvasElement>('toy');
  const wrap = canvas.parentElement!;
  const mute = $<HTMLButtonElement>('mute');
  const beat = $<HTMLButtonElement>('beat');

  const app = new App(canvas, initialBoard(), {
    capture,
    attract,
    reducedMotion,
    onBoardChange: (b) => { renderKit(b); syncUrl(b); },
    onAttractEnd: () => { document.body.classList.remove('attract'); requestAnimationFrame(() => fit()); },
    onFirstSound: () => undefined,
  });
  window.__tumblewood = app;

  const fit = () => {
    const r = wrap.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    app.resize(r.width, r.height);
    if (capture) app.draw();
  };
  fit();
  new ResizeObserver(() => fit()).observe(wrap);
  renderKit(app.run.board);
  if (!attract && !capture) syncUrl(app.run.board);

  // Controls.
  $('drop').addEventListener('click', () => app.drop());
  beat.addEventListener('click', () => {
    const on = !app.beat;
    app.setBeat(on);
    beat.setAttribute('aria-pressed', String(on));
    beat.querySelector('.beat-label')!.textContent = on ? 'Stop dropping' : 'Keep dropping';
  });
  mute.addEventListener('click', () => {
    const m = !app.sound.muted;
    app.sound.setMuted(m);
    mute.setAttribute('aria-pressed', String(m));
    mute.querySelector('.mute-label')!.textContent = m ? 'Sound off' : 'Sound on';
    if (!m) app.ensureSound();
  });
  $('reset').addEventListener('click', () => {
    app.setBoard(starter());
    renderKit(app.run.board);
    syncUrl(app.run.board);
    $('share-note').textContent = 'Back to the first run.';
  });
  $('share').addEventListener('click', async () => {
    const link = location.href;
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch { ok = false; }
    $('share-note').textContent = ok ? 'Link copied. Anyone who opens it gets this exact run.' : `Copy this link: ${link}`;
  });
  $('order').addEventListener('click', () => {
    const k = kitOf(app.run.board);
    const done = $('order-done');
    done.hidden = false;
    done.textContent = `This is a demo shop, so nothing was ordered and nothing was charged. Your ${money(k.total)} kit is still on the board above.`;
  });

  // Any real input ends attract mode.
  if (attract) {
    const end = () => { app.endAttract(); window.removeEventListener('keydown', end); };
    window.addEventListener('keydown', end);
  }

  // Pause when hidden or scrolled away.
  let onScreen = true;
  document.addEventListener('visibilitychange', () => app.setActive(!document.hidden, onScreen));
  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    app.setActive(!document.hidden, onScreen);
  }, { threshold: 0.02 }).observe(canvas);

  if (capture) {
    window.__step = (ms: number) => { app.advance(ms / 1000); app.draw(); };
  }
  app.start();
  document.documentElement.dataset.ready = '1';
}

void boot();
