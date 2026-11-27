// Marble physics written for this toy: glass circles against capsules (ramps, chime bars, bell lips) and circles
// (bell domes), with a fixed time step, swept collision tests (no tunnelling), restitution and friction per material,
// and rolling handled with real spin (a solid sphere rolls down a slope at 5/7 of the sliding acceleration).
// Everything here is plain arithmetic in a fixed order, so the same board and the same drops give the same result.

export type Material = 'wood' | 'metal' | 'brass';

export interface MaterialSpec {
  /** Coefficient of restitution for a firm hit. */
  e: number;
  /** Coulomb friction between glass and this surface. */
  mu: number;
  /** Rolling resistance, as a deceleration in pitches per second squared. */
  roll: number;
}

export const MATERIALS: Record<Material, MaterialSpec> = {
  wood: { e: 0.3, mu: 0.6, roll: 0.25 },
  metal: { e: 0.5, mu: 0.25, roll: 0.05 },
  brass: { e: 0.5, mu: 0.3, roll: 0.05 },
};

export interface Capsule {
  kind: 'cap';
  ax: number; ay: number; bx: number; by: number;
  r: number;
  mat: Material;
  /** Index of the piece this belongs to, or -1 for the board's own parts (tray). */
  owner: number;
  /** What the collider is, for sound and drawing. */
  tag: string;
}

export interface Circle {
  kind: 'circ';
  x: number; y: number; r: number;
  mat: Material;
  owner: number;
  tag: string;
}

export type Collider = Capsule | Circle;

export interface Marble {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  /** Angular velocity (radians per second). */
  w: number;
  /** Accumulated rotation, for drawing. */
  angle: number;
  /** Seconds the marble has been nearly still (used by the tray). */
  still: number;
  /** Counts down once the marble is being returned to the bag; removed at 0. */
  fade: number;
  /** True while the marble touched something during the last step. */
  touching: boolean;
  /** Tag of the last thing it rolled on, for the rolling sound. */
  rollingOn: string;
}

export interface HitEvent {
  /** Simulation time of the hit in seconds. */
  t: number;
  x: number; y: number;
  /** Normal speed of the impact in pitches per second. */
  speed: number;
  mat: Material | 'glass';
  owner: number;
  tag: string;
  marble: number;
}

export interface WorldOptions {
  gravity: number;
  radius: number;
  dt: number;
  /** Impacts slower than this do not bounce at all (resting contact). */
  restSpeed: number;
  /** Impacts slower than this make no sound. */
  hitSpeed: number;
  /** Anything below this y is gone. */
  floorY: number;
  minX: number;
  maxX: number;
}

export const DEFAULTS: WorldOptions = {
  gravity: 72,
  radius: 0.3,
  dt: 1 / 240,
  restSpeed: 0.7,
  hitSpeed: 1.2,
  floorY: 17,
  minX: -2,
  maxX: 12,
};

const SKIN = 1e-5;
const GLASS_E = 0.82;

interface Hit { tau: number; nx: number; ny: number; c: Collider | null; inside: boolean; }

/** Earliest time (0..1) at which point p moving by d comes within R of segment a-b. */
function sweepCapsule(px: number, py: number, dx: number, dy: number, c: Capsule, R: number, out: Hit): boolean {
  const ex = c.bx - c.ax, ey = c.by - c.ay;
  const len2 = ex * ex + ey * ey;
  // Closest point at the start, for the inside test.
  let s = len2 > 0 ? ((px - c.ax) * ex + (py - c.ay) * ey) / len2 : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const qx = c.ax + ex * s, qy = c.ay + ey * s;
  const fx = px - qx, fy = py - qy;
  const d2 = fx * fx + fy * fy;
  if (d2 < (R - SKIN) * (R - SKIN)) {
    const d = Math.sqrt(d2);
    if (d > 1e-9) { out.nx = fx / d; out.ny = fy / d; } else { out.nx = -ey / Math.sqrt(len2); out.ny = ex / Math.sqrt(len2); if (out.ny > 0) { out.nx = -out.nx; out.ny = -out.ny; } }
    out.tau = 0; out.inside = true; out.c = c;
    return true;
  }
  let best = Infinity, bnx = 0, bny = 0;
  const len = Math.sqrt(len2);
  if (len > 0) {
    const ux = ex / len, uy = ey / len;
    for (let side = -1; side <= 1; side += 2) {
      const nx = -uy * side, ny = ux * side;
      const h0 = (px - c.ax) * nx + (py - c.ay) * ny;
      const dh = dx * nx + dy * ny;
      if (h0 >= R - SKIN && dh < 0) {
        const tau = (R - h0) / dh;
        if (tau <= 1 && tau < best) {
          const cx = px + dx * tau - c.ax, cy = py + dy * tau - c.ay;
          const proj = cx * ux + cy * uy;
          if (proj >= 0 && proj <= len) { best = tau < 0 ? 0 : tau; bnx = nx; bny = ny; }
        }
      }
    }
  }
  for (let k = 0; k < 2; k++) {
    const cx = k === 0 ? c.ax : c.bx, cy = k === 0 ? c.ay : c.by;
    const t = sweepCircleRaw(px, py, dx, dy, cx, cy, R);
    if (t >= 0 && t < best) {
      best = t;
      const hx = px + dx * t - cx, hy = py + dy * t - cy;
      const hl = Math.sqrt(hx * hx + hy * hy) || 1;
      bnx = hx / hl; bny = hy / hl;
    }
  }
  if (best === Infinity) return false;
  out.tau = best; out.nx = bnx; out.ny = bny; out.c = c; out.inside = false;
  return true;
}

/** Time 0..1 of first contact of a moving point with a circle of radius R, or -1. Assumes the start is outside. */
function sweepCircleRaw(px: number, py: number, dx: number, dy: number, cx: number, cy: number, R: number): number {
  const fx = px - cx, fy = py - cy;
  const b = fx * dx + fy * dy;
  if (b >= 0) return -1; // moving away
  const a = dx * dx + dy * dy;
  const cc = fx * fx + fy * fy - R * R;
  const disc = b * b - a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t > 1) return -1;
  return t < 0 ? 0 : t;
}

function sweepCircle(px: number, py: number, dx: number, dy: number, c: Circle, R: number, out: Hit): boolean {
  const fx = px - c.x, fy = py - c.y;
  const d2 = fx * fx + fy * fy;
  if (d2 < (R - SKIN) * (R - SKIN)) {
    const d = Math.sqrt(d2) || 1;
    out.nx = fx / d; out.ny = fy / d; out.tau = 0; out.inside = true; out.c = c;
    return true;
  }
  const t = sweepCircleRaw(px, py, dx, dy, c.x, c.y, R);
  if (t < 0) return false;
  const hx = px + dx * t - c.x, hy = py + dy * t - c.y;
  const hl = Math.sqrt(hx * hx + hy * hy) || 1;
  out.tau = t; out.nx = hx / hl; out.ny = hy / hl; out.c = c; out.inside = false;
  return true;
}

function closestOn(c: Collider, px: number, py: number): [number, number] {
  if (c.kind === 'circ') return [c.x, c.y];
  const ex = c.bx - c.ax, ey = c.by - c.ay;
  const len2 = ex * ex + ey * ey;
  let s = len2 > 0 ? ((px - c.ax) * ex + (py - c.ay) * ey) / len2 : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  return [c.ax + ex * s, c.ay + ey * s];
}

export class World {
  readonly o: WorldOptions;
  colliders: Collider[] = [];
  marbles: Marble[] = [];
  /** Simulation time in seconds (step count times dt, computed from the count to avoid drift). */
  steps = 0;
  private nextId = 1;
  events: HitEvent[] = [];
  /** Optional region where marbles are counted as resting in the tray. */
  trayY = Infinity;
  trayKeep = 4;
  private hit: Hit = { tau: 0, nx: 0, ny: 0, c: null, inside: false };

  constructor(opts: Partial<WorldOptions> = {}) {
    this.o = { ...DEFAULTS, ...opts };
  }

  get time(): number { return this.steps * this.o.dt; }

  addMarble(x: number, y: number, vx = 0, vy = 0): Marble {
    const m: Marble = { id: this.nextId++, x, y, vx, vy, w: 0, angle: 0, still: 0, fade: -1, touching: false, rollingOn: '' };
    this.marbles.push(m);
    return m;
  }

  /** Kinetic (with spin) plus potential energy per unit mass of one marble; y grows downward. */
  energy(m: Marble): number {
    const r = this.o.radius;
    return 0.5 * (m.vx * m.vx + m.vy * m.vy) + 0.5 * 0.4 * r * r * m.w * m.w - this.o.gravity * m.y;
  }

  step(): void {
    const { dt, gravity: g, radius: r } = this.o;
    const t = (this.steps + 1) * dt;
    for (let i = 0; i < this.marbles.length; i++) {
      const m = this.marbles[i];
      const e0 = this.energy(m);
      this.moveMarble(m, dt, g, r, t);
      this.guard(m, e0);
    }
    this.collideMarbles(t);
    this.tidy(dt);
    this.steps++;
  }

  private moveMarble(m: Marble, dt: number, g: number, r: number, t: number): void {
    m.vy += g * dt;
    let rem = 1;
    m.touching = false;
    let lastHit: Collider | null = null;
    for (let iter = 0; iter < 5 && rem > 0; iter++) {
      const dx = m.vx * dt * rem, dy = m.vy * dt * rem;
      let best: Hit | null = null;
      let bt = Infinity, bnx = 0, bny = 0, bc: Collider | null = null, binside = false;
      for (let k = 0; k < this.colliders.length; k++) {
        const c = this.colliders[k];
        const ok = c.kind === 'cap' ? sweepCapsule(m.x, m.y, dx, dy, c, c.r + r, this.hit) : sweepCircle(m.x, m.y, dx, dy, c, c.r + r, this.hit);
        if (!ok) continue;
        if (this.hit.inside) {
          // Pushed out of a piece that was placed on top of it (or a deep corner). Always resolved first.
          if (!binside || this.hit.tau < bt) { bt = 0; bnx = this.hit.nx; bny = this.hit.ny; bc = c; binside = true; }
          continue;
        }
        if (binside) continue;
        // Only count it if we are moving into the surface.
        if (dx * this.hit.nx + dy * this.hit.ny >= 0) continue;
        if (this.hit.tau < bt) { bt = this.hit.tau; bnx = this.hit.nx; bny = this.hit.ny; bc = c; }
      }
      if (bc) best = this.hit;
      if (!best || !bc) {
        m.x += dx; m.y += dy;
        rem = 0;
        break;
      }
      if (binside) {
        const [qx, qy] = closestOn(bc, m.x, m.y);
        const R = bc.r + r + SKIN * 2;
        m.x = qx + bnx * R; m.y = qy + bny * R;
      } else {
        const len = Math.sqrt(dx * dx + dy * dy);
        const back = len > 0 ? Math.min(bt, SKIN / len) : 0;
        m.x += dx * (bt - back); m.y += dy * (bt - back);
        rem *= 1 - bt;
      }
      this.resolve(m, bc, bnx, bny, r, dt, t, bc === lastHit);
      lastHit = bc;
      m.touching = true;
      m.rollingOn = bc.tag;
    }
  }

  /**
   * Numerical guard: in a wedge (a marble pinned between two surfaces) the fixed step can turn a little spin into a
   * little lift. Real contacts only ever lose energy, so any gain is taken back out of the motion.
   */
  private guard(m: Marble, e0: number): void {
    const e1 = this.energy(m);
    if (e1 <= e0) return;
    const r = this.o.radius;
    const kin = 0.5 * (m.vx * m.vx + m.vy * m.vy) + 0.2 * r * r * m.w * m.w;
    const target = kin - (e1 - e0);
    const k = target > 0 && kin > 0 ? Math.sqrt(target / kin) : 0;
    m.vx *= k; m.vy *= k; m.w *= k;
    if (target < 0) m.y += (-target) / this.o.gravity; // only in a deep wedge: give back the last sliver of lift
  }

  /** Velocity response at a contact: bounce, friction that drives the marble toward rolling, rolling resistance. */
  private resolve(m: Marble, c: Collider, nx: number, ny: number, r: number, dt: number, t: number, repeat: boolean): void {
    const spec = MATERIALS[c.mat];
    const vn = m.vx * nx + m.vy * ny;
    if (vn >= 0) return;
    const impact = -vn;
    const e = impact < this.o.restSpeed ? 0 : spec.e;
    const jn = (1 + e) * impact; // normal change in velocity
    m.vx += jn * nx; m.vy += jn * ny;
    // Tangent and slip at the contact point.
    const tx = -ny, ty = nx;
    const vt = m.vx * tx + m.vy * ty;
    const slip = vt - m.w * r;
    let jt = -slip / 3.5;
    const lim = spec.mu * jn;
    if (jt > lim) jt = lim; else if (jt < -lim) jt = -lim;
    m.vx += jt * tx; m.vy += jt * ty;
    m.w -= (2.5 * jt) / r;
    // Rolling resistance: only while in steady contact (not on a hard bounce).
    if (e === 0) {
      const vt2 = m.vx * tx + m.vy * ty;
      const dec = Math.min(Math.abs(vt2), spec.roll * dt);
      const sgn = vt2 > 0 ? -1 : 1;
      m.vx += sgn * dec * tx; m.vy += sgn * dec * ty;
      // Spin slows in proportion, so this can only take energy away.
      if (vt2 !== 0) m.w *= (Math.abs(vt2) - dec) / Math.abs(vt2);
    }
    if (impact >= this.o.hitSpeed && !repeat) {
      this.events.push({ t, x: m.x - nx * r, y: m.y - ny * r, speed: impact, mat: c.mat, owner: c.owner, tag: c.tag, marble: m.id });
    }
  }

  private collideMarbles(t: number): void {
    const ms = this.marbles, d = this.o.radius * 2;
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i], b = ms[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= d * d || d2 === 0) continue;
        const dist = Math.sqrt(d2);
        const nx = dx / dist, ny = dy / dist;
        const push = (d - dist) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vrel < 0) {
          const e = -vrel < this.o.restSpeed ? 0 : GLASS_E;
          const j = (-(1 + e) * vrel) / 2;
          a.vx -= j * nx; a.vy -= j * ny;
          b.vx += j * nx; b.vy += j * ny;
          if (-vrel >= this.o.hitSpeed) {
            this.events.push({ t, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: -vrel, mat: 'glass', owner: -1, tag: 'glass', marble: a.id });
          }
        }
      }
    }
  }

  private tidy(dt: number): void {
    const o = this.o;
    let inTray = 0;
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      m.angle += m.w * dt;
      const sp = Math.abs(m.vx) + Math.abs(m.vy);
      m.still = sp < 0.25 && m.touching ? m.still + dt : 0;
      if (m.fade >= 0) {
        m.fade -= dt;
        if (m.fade <= 0) { this.marbles.splice(i, 1); continue; }
      }
      if (m.y > o.floorY || m.x < o.minX || m.x > o.maxX) { this.marbles.splice(i, 1); continue; }
      if (m.y > this.trayY && m.fade < 0) inTray++;
    }
    // The tray keeps the newest few; the oldest goes back in the bag.
    if (inTray > this.trayKeep) {
      for (const m of this.marbles) {
        if (m.y > this.trayY && m.fade < 0) { m.fade = 0.5; break; }
      }
    }
  }

  /** Drain hit events (for sound and drawing). */
  takeEvents(): HitEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
