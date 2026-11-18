// ============================================================================
// world layout + procedural content generation (load-time only)
// ============================================================================

// The forest stands between the floor (about y = -48) and the canopy plane (CAN in shaders.js, y = -15).
// rock outcrops on the forest floor: ax, az, bx, bz, radius, top, overhang, waist
const MESAS = [
  [-40, 20, -34, 34, 7, -36, 2, 1.5], [70, -40, 76, -30, 8, -33, 2.5, 2], [-70, -60, -64, -48, 7, -35, 2, 1.5],
  [24, 96, 34, 100, 7, -37, 2, 1], [-100, 40, -96, 52, 9, -31, 3, 2], [95, 50, 100, 60, 8, -34, 2, 1.5],
];
// the ocean's ring arches and carved tunnels are not used in the forest
const ARCHES = [];
const HOLES = [];
// regions kept free of terraces (around the viewpoints and the camera path): ax, az, bx, bz, radius, softness
const CLEARS = [
  [10, 8, -8, -14, 16, 8], [-8, -14, 10, -64, 15, 8], [10, -64, 44, 0, 15, 8], [44, 0, 3, 66, 16, 8],
  [40, 30, 60, 10, 15, 8], [-26, -100, -12, -106, 16, 8], [-55, -18, -48, -10, 15, 8], [3, 66, -12, 90, 15, 8],
];
// the purple grotto zone of the ocean is switched off (main.js reads PURPLE for its zone blend)
const PURPLE = [1e5, 1e5];
// sun direction per metre of height (main.js SUN before it is normalised): a hole in the canopy at (x, z) lights the
// floor at (x - SUNX * h, z - SUNZ * h), h metres below
const SUNX = 0.27, SUNZ = -0.24;
// designed clearings in the canopy (x, z, radius): light shafts for viewpoints 1 and 2, sky holes for 3 and 5,
// holes to rise through at 4 and 6. makeWorld scatters about 70 smaller ones.
const GAPS = [[0.9, -19.9, 7], [60, 8.4, 6], [-12, -106, 8], [-48, -10, 6], [10, -62, 6.5], [3, 66, 8]];
// insects, counts at High (Medium and Low keep a half / a quarter): fireflies over the dark floor, gnats per swarm
// in a designed clearing's light shaft (the swarms of the small scattered clearings get 0.6 of that)
const FIREFLIES = 4500, SWARM = 150, SWARMS = 6;
function primBuffer() {
  const a = [];
  for (const m of MESAS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of HOLES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  return new Float32Array(a);
}

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- instance stores
function makeWorld(D, T, flyPts, POSES) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp;
  const Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - OZ) / CELLW), 0, CELLS - 1);
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  // Medium and Low keep every 2nd / 4th leaf (but every vine stem), made wider; the random stream is the same
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || !(nth++ % THIN)) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, type === 1 ? wid : wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  const glints = [];
  const glint = (...a) => { nth++ % THIN || glints.push(...a); };
  const solids = []; // per mesh id: arrays of 12 floats
  const props = Array.from({ length: 6 }, () => Array.from({ length: nCells }, () => []));
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    fl.length = 0; let ceil = 3;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, min(ceil, CAN) - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[f.length - 2] : -48; };
  const grad = (x, y, z) => {
    const e = 0.6; let nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const disc = (R) => { const a = rnd() * TAU, r = sqrt(rnd()) * R; return [cos(a) * r, sin(a) * r]; };
  // the camera path and the viewpoints: nearFly for things on the ground (it has a height window), nearPath for
  // anything tall (XZ only: trunks and lianas have no collision, so they must not stand in the way at any height)
  const nearFly = (x, y, z, r) => { for (const p of flyPts) if (hypot(x - p[0], z - p[2]) < r && y < p[1] + 3 && y > p[1] - 13) return true; return false; };
  const nearPose = (x, z, r = 3) => { for (const p of POSES) if (hypot(x - p[0], z - p[2]) < r) return true; return false; };
  const nearPath = (x, z, r) => { for (const p of flyPts) { const dx = x - p[0], dz = z - p[2]; if (dx * dx + dz * dz < r * r) return true; } return false; };
  // viewpoints up in the crowns: no big tree (boughs reach 9 m) close to them
  const nearHigh = (x, z, r) => { for (const p of POSES) if (p[1] > 18 && hypot(x - p[0], z - p[2]) < r) return true; return false; };
  // 1 near the camera path, 0 far from it: the forest is densest where it is looked at
  const PG = 64, pathD = new Float32Array(PG * PG);
  for (let j = 0; j < PG; j++) for (let i = 0; i < PG; i++) {
    const x = OX + (i + 0.5) * 384 / PG, z = OZ + (j + 0.5) * 384 / PG; let d = 1e9;
    for (const p of flyPts) d = min(d, hypot(x - p[0], z - p[2]));
    pathD[i + PG * j] = d;
  }
  const near = (x, z) => sstep(50, 14, pathD[clamp(floor((x - OX) / 384 * PG), 0, PG - 1) + PG * clamp(floor((z - OZ) / 384 * PG), 0, PG - 1)]);

  // --- clearings in the canopy, at the resolution of the light volume (its g channel carries them to the shaders)
  rseed(20);
  const gaps = GAPS.map((g) => g.slice());
  for (let i = 0; i < 70; i++) { const p = disc(165); gaps.push([p[0], p[1], rr(2.5, 5.5)]); }
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2, C = new Float32Array(hx * hz);
  for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
    const wx = OX + (x + 0.5) * 2 * VS, wz = OZ + (z + 0.5) * 2 * VS; let c = 0;
    for (const p of gaps) { const d = hypot(wx - p[0], wz - p[1]); if (d < p[2]) c = max(c, sstep(p[2], p[2] * 0.55, d)); }
    C[x + hx * z] = c;
  }
  const gapAt = (x, z) => C[clamp(floor((x - OX) / (2 * VS)), 0, hx - 1) + hx * clamp(floor((z - OZ) / (2 * VS)), 0, hz - 1)];

  // a spray of broad leaves around a point (none in the clearings up in the canopy: the shadow bake would close them)
  const spray = (x, y, z, n, rad, type, lmin, lmax, tmin, tmax, sw) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = sqrt(rnd()) * rad, lx = x + cos(a) * r, lz = z + sin(a) * r, ly = y + rr(-0.5, 0.5) * rad, L = rr(lmin, lmax);
      const yaw = a + rr(-0.6, 0.6), tilt = rr(tmin, tmax), w = L * rr(0.4, 0.55), s1 = rnd(), s2 = rnd(), bend = rr(0.35, 0.6);
      if (ly > CAN - 7 && gapAt(lx, lz) > 0.2) continue;
      leaf(big, lx, ly, lz, L, yaw, tilt, w, sw, type, s1, s2, bend);
    }
  };

  // --- big trees: trunk + boughs are one mesh (ids 10 and 11, drawn unculled), the crown is leaf sprays at the bough tips
  rseed(1);
  const okey = (x, z, c) => floor(x / c) * 8192 + floor(z / c), occ = new Set();
  for (let i = 0; i < 9000; i++) {
    const [x, z] = disc(172), k = okey(x, z, 5.5), em = rnd() < 0.05, v = rnd() < 0.5 ? 0 : 1, yaw = rnd() * TAU, sj = rnd(), sd = rnd();
    if (occ.has(k) || gapAt(x, z) > 0.02 || nearPath(x, z, 3.2) || nearHigh(x, z, 10)) continue;
    const y0 = gy(x, z);
    if (y0 > CAN - 16 || grad(x, y0, z)[1] < 0.6) continue;
    occ.add(k);
    // emergents stand a third taller and break through the canopy (not over the camera path)
    // 36.5: the highest bough tips end just over the canopy plane, inside the dome of leaves below
    const tall = em && !nearPath(x, z, 14), s = (CAN - y0) / 36.5 * (tall ? mix(1.28, 1.45, sj) : mix(0.95, 1.05, sj)), cy = cos(yaw), sy = sin(yaw), m = treeMesh(v);
    solid(10 + v, x, y0, z, s, qAxis(0, 1, 0, yaw), 2, sd, 1, 0);
    for (const t of m.tips) spray(x + (t[0] * cy + t[2] * sy) * s, y0 + t[1] * s, z + (t[2] * cy - t[0] * sy) * s, tall ? 24 : 9, tall ? 2.4 : 1.7, 0, 0.8, 1.7, 0.9, 1.9, 2);
    // the top of the crown: a low dome of leaves over the canopy plane, which is what is seen from above
    const R = rr(4, 6.5) * s, top = tall ? y0 + 36 * s : CAN + 0.4;
    for (let j = 0; j < 85; j++) {
      const b = rnd() * TAU, q = sqrt(rnd()), lx = x + cos(b) * q * R, lz = z + sin(b) * q * R, L = rr(1.1, 2.1), yw = b + rr(-0.7, 0.7), tl = rr(0.7, 1.5), w = L * rr(0.42, 0.55), dy = rr(-0.3, 0.3), s1 = rnd(), s2 = rnd();
      if (gapAt(lx, lz) > 0.15) continue;
      leaf(big, lx, top + 2.6 * (1 - q * q) + dy, lz, L, yw, tl, w, 3, 0, s1, s2, 0.45);
    }
  }
  // --- understorey: thin pole trees with a small crown, at all heights between the floor and the canopy
  rseed(2);
  const occ2 = new Set();
  for (let i = 0; i < 16000; i++) {
    const [x, z] = disc(172), k = okey(x, z, 2.6), u = rnd(), hh = rr(6, 20), yaw = rnd() * TAU, lean = qAxis(rr(-1, 1), 0, rr(-1, 1), rr(0, 0.07)), sd = rnd(), two = rnd() < 0.5;
    if (occ2.has(k) || nearPath(x, z, 3.6) || u > 0.4 + 0.6 * near(x, z)) continue;
    const y0 = gy(x, z);
    if (y0 > CAN - 12 || grad(x, y0, z)[1] < 0.55) continue;
    occ2.add(k);
    const H = min(hh, CAN - 2 - y0);
    solid(4, x, y0 - 0.3, z, H, qMul(lean, qAxis(0, 1, 0, yaw)), 4, sd, 1, 0);
    spray(x, y0 + H * 0.92, z, 20, 1 + H * 0.09, 0, 0.6, 1.3, 0.7, 1.7, 1.5);
    if (two) spray(x, y0 + H * 0.62, z, 8, 1 + H * 0.07, 0, 0.5, 1.1, 0.9, 1.7, 1);
  }
  // --- lianas: thick ones hanging from the canopy (some to the ground), swags between the crowns, thin vines with moss
  rseed(3);
  for (let i = 0; i < 4200; i++) {
    const [x, z] = disc(170), drop = rr(0, 2.5), want = rr(9, 34), yaw = rnd() * TAU, sd = rnd();
    if (nearPath(x, z, 2) || gapAt(x, z) > 0.3) continue;
    const top = CAN - drop, len = min(top - gy(x, z) + 0.3, want);
    if (len > 6) solid(5, x, top, z, len, qAxis(0, 1, 0, yaw), 3, sd, 1, 0);
  }
  for (let i = 0; i < 1500; i++) {
    const [x, z] = disc(170), y = CAN - rr(1.5, 10), sc = rr(4, 7.5), yaw = rnd() * TAU, sd = rnd();
    if (nearPath(x, z, 4.5) || gapAt(x, z) > 0.3 || y - gy(x, z) < 8) continue;
    solid(6, x, y, z, sc, qAxis(0, 1, 0, yaw), 3, sd, 1, 0);
  }
  for (let i = 0; i < 14000; i++) {
    const [x, z] = disc(170), y = CAN - rr(0.2, 3), L = rr(2.5, 9), n = (rnd() * 4) | 0;
    if (gapAt(x, z) > 0.2 || nearPath(x, z, 2.5)) continue;
    leaf(big, x, y, z, L, rnd() * TAU, PI - rr(0, 0.22), rr(0.05, 0.1), 1, 1, rnd(), rnd(), rr(0.3, 0.42));
    for (let j = 0; j < n; j++) leaf(big, x + rr(-0.3, 0.3), y - rnd() * L * 0.8, z + rr(-0.3, 0.3), rr(0.5, 1.4), rnd() * TAU, PI - rr(0, 0.5), rr(0.12, 0.3), 1, 6, rnd(), rnd(), rr(0.3, 0.5));
  }
  // --- the underside of the canopy: drooping leaves that give the flat canopy plane some depth from below
  rseed(4);
  for (let i = 0; i < 75000; i++) {
    const [x, z] = disc(172), L = rr(0.8, 1.9), y = CAN - rr(0.2, 3.5), yaw = rnd() * TAU, tilt = rr(1.5, 2.7), w = L * rr(0.4, 0.55), ty = rnd() < 0.85 ? 0 : 6, s1 = rnd(), s2 = rnd();
    if (gapAt(x, z) > 0.2) continue;
    leaf(big, x, y, z, L, yaw, tilt, w, 1.5, ty, s1, s2, 0.5);
  }

  // --- the forest floor: ferns, big-leaved plants (some in flower), shrubs; fireflies over the ferns
  rseed(5);
  for (let i = 0; i < 160000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1], u = rnd();
    if (hypot(x, z) > 172 || ny < 0.6 || nearPose(x, z, 2.5) || nearFly(x, y, z, 1.6)) continue;
    const w = 0.4 + 0.6 * near(x, z), shrub = !nearPose(x, z, 7);
    if (u < 0.30 * w) {
      const n = 6 + (rnd() * 7 | 0), a0 = rnd() * TAU, s = rr(0.7, 1.5);
      for (let j = 0; j < n; j++) { const L = s * rr(0.75, 1.25); leaf(big, x, y - 0.1, z, L, a0 + j * TAU / n + rr(-0.3, 0.3), rr(0.45, 1.15), L * rr(0.22, 0.32), 0.6, 2, rnd(), rnd(), rr(0.5, 0.85)); }
      if (rnd() < 0.25) glint(x + rr(-1, 1), y + rr(0.4, 1.8), z + rr(-1, 1), 1, rnd(), rnd() * 0.6, rr(0.012, 0.03), 0);
    } else if (u < 0.40 * w) {
      const n = 4 + (rnd() * 5 | 0), a0 = rnd() * TAU, s = rr(1.2, 2.6);
      for (let j = 0; j < n; j++) { const L = s * rr(0.7, 1.2); leaf(big, x + rr(-0.15, 0.15), y - 0.15, z + rr(-0.15, 0.15), L, a0 + j * TAU / n + rr(-0.4, 0.4), rr(0.2, 0.85), L * rr(0.26, 0.36), 0.8, 3, rnd(), rnd(), rr(0.4, 0.7)); }
      if (rnd() < 0.3) for (let j = 0; j < 3; j++) leaf(big, x + rr(-0.2, 0.2), y + s * rr(0.3, 0.6), z + rr(-0.2, 0.2), rr(0.25, 0.5), rnd() * TAU, rr(0.1, 0.7), rr(0.1, 0.18), 0.5, 7, rnd(), rnd(), rr(0.3, 0.5));
    } else if (u < 0.46 * w && shrub) {
      const sc = rr(1.5, 3.2);
      solid(7 + (rnd() * 2 | 0), x, y - 0.15, z, sc, qAxis(0, 1, 0, rnd() * TAU), 4, rnd(), 1, 0);
      spray(x, y + sc * 0.75, z, 16, sc * 0.5, 0, 0.45, 1.0, 0.6, 1.6, 0.8);
    }
  }
  // --- ground cover: leaf litter lying flat everywhere, moss and seedlings in patches
  const mossAt = (x, z) => sstep(0.46, 0.62, fbm(x * 0.045, 7, z * 0.045, 3));
  rseed(6);
  for (let i = 0; i < 520000; i++) {
    const k = pickV(), ny = T.wn[k + 1];
    if (ny < 0.72) continue;
    const x = T.wp[k] + rr(-0.45, 0.45), z = T.wp[k + 2] + rr(-0.45, 0.45), y = T.wp[k + 1];
    if (hypot(x, z) > 170 || nearPose(x, z, 1)) continue;
    const u = rnd();
    if (u < 0.45) leaf(small, x, y + 0.03, z, rr(0.1, 0.24), rnd() * TAU, rr(1.35, 1.6), rr(0.06, 0.13), 0, 4, rnd(), rnd(), rr(0.15, 0.3));
    else if (u < 0.45 + 0.5 * mossAt(x, z)) for (let j = 0; j < 3; j++) leaf(small, x + rr(-0.12, 0.12), y - 0.04, z + rr(-0.12, 0.12), rr(0.1, 0.32), rnd() * TAU, rr(0.1, 0.9), rr(0.05, 0.1), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
  }

  // --- rocks: boulders, chunks embedded in the outcrops and terraces, stones; fallen logs
  rseed(9);
  for (let i = 0; i < 900; i++) {
    const k = pickV(); if (T.wn[k + 1] < 0.7 || hypot(T.wp[k], T.wp[k + 2]) > 170 || nearPath(T.wp[k], T.wp[k + 2], 3)) continue;
    const sc = rr(0.25, 1.2) * (rnd() < 0.1 ? 1.8 : 1);
    solid(rnd() * 4 | 0, T.wp[k], T.wp[k + 1] + sc * 0.15, T.wp[k + 2], sc, qRand(), 1, rnd(), 1, 0);
  }
  rseed(10);
  for (let i = 0; i < 22000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || (ny > 0.8 && rnd() < 0.85) || nearFly(x, y, z, 3.5)) continue;
    const sc = (0.35 + 2.1 * pow(rnd(), 2.6)) * (ny > 0.8 ? 0.5 : 1), q = qRand();
    chunks[(sc > 1.15 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 1.15 ? 0 : 96, 0);
  }
  rseed(11);
  for (let i = 0; i < 50000; i++) {
    const k = pickV(), x = T.wp[k] + rr(-0.4, 0.4), z = T.wp[k + 2] + rr(-0.4, 0.4), y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || hypot(x, z) > 170 || nearFly(x, y, z, 1.3)) continue;
    const sc = 0.05 + 0.3 * pow(rnd(), 2), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }
  rseed(12);
  for (let i = 0; i < 700; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], sc = rr(3, 6.5), q = qMul(qAxis(0, 1, 0, rnd() * TAU), qAxis(0, 0, 1, rr(-0.06, 0.06))), sd = rnd();
    if (T.wn[k + 1] < 0.85 || hypot(x, z) > 168 || nearPath(x, z, 4)) continue;
    solid(9, x, y + sc * 0.035, z, sc, q, 5, sd, 1, 0);
  }

  // --- the ocean's bubble pass draws the insects now (filled at the end of makeWorld)
  const bubbles = [];

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(n * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res volume: r = openness (terrain), g = skylight. At and above the canopy g is the clearing map itself
  // (the shaders read it there to open the leaf cover); below, the light that falls through spreads out on its way down.
  const volD = new Uint8Array(hx * hy * hz * 2), yc = floor((CAN - 1.5 - OY) / (2 * VS));
  let Lp = new Float32Array(hx * hz), Ln = new Float32Array(hx * hz); const tmp = new Float32Array(hx * hz);
  for (let i = 0; i < hx * hz; i++) Lp[i] = 0.22 + 0.78 * C[i];
  for (let y = hy - 1; y >= 0; y--) {
    const below = y < yc;
    if (below) for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) { const i = x + hx * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i]) * 0.25; }
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
      const i = x + hx * z, g0 = gi(x * 2, y * 2, z * 2), o = x + hx * (y + hy * z);
      const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
      volD[o * 2] = clamp(0.5 - d / 12, 0, 1) * 255;
      if (!below) { volD[o * 2 + 1] = C[i] * 255; continue; }
      const b = (tmp[z > 0 ? i - hx : i] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i]) * 0.25;
      Ln[i] = b * clamp(0.5 - d / 1.5, 0, 1);
      volD[o * 2 + 1] = min(1, b) * 255;
    }
    if (below) { const t = Lp; Lp = Ln; Ln = t; }
  }

  // --- ground map: r moss and seedling cover, a wet mud (g and b are free)
  const gm = new Uint8Array(512 * 512 * 4);
  for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
    const x = (i + 0.5) / 512 * 384 - 192, z = (j + 0.5) / 512 * 384 - 192, o = (i + 512 * j) * 4;
    gm[o] = mossAt(x, z) * 255; gm[o + 3] = sstep(0.5, 0.66, fbm(x * 0.04, 3, z * 0.04, 3)) * 255;
  }

  // --- butterflies (the fish shader) in the light under the designed clearings, big birds (the manta shader)
  // soaring over the canopy
  const fish = [], mantas = [];
  rseed(14);
  for (const g of GAPS) for (const up of [6, 17]) {
    const x = g[0] - SUNX * (33 - up), z = g[1] - SUNZ * (33 - up), R = rr(3, 5), n = up > 6 ? 30 : 60, sp = rnd() < 0.5 ? 1 : -1, sd = rnd();
    for (let i = 0; i < n; i++) fish.push(x, gy(x, z) + up, z, R, rnd(), sp * 1.9 / R, 0.13, sd);
  }
  for (let i = 0; i < 5; i++) { const [x, z] = disc(90); mantas.push(x, CAN + rr(9, 15), z, rr(30, 70), rnd() * TAU, (i & 1 ? 1 : -1) * rr(0.1, 0.16), 1.1, rnd()); }

  // --- pollen and insects drifting around the camera
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();
  if (!glints.length) glints.push(0, -200, 0, 0, 0, 0, 0, 0);

  // --- insects, 8 floats each, animated entirely in the vertex shader (vsBug):
  //   firefly: x, y, z, wander radius | seed, flash period (s), size, 0
  //   gnat:    swarm centre, swarm radius | seed, swarm seed, size, 1
  // They have their own random streams, and the stream of the generators above is put back afterwards.
  const keepSeed = _seed;
  // fireflies: low over the floor, most of them near the camera path, none where a baked clearing lights the spot
  // (the shader dims the ones that wander into the sun flecks of the canopy texture, which are not known here)
  rseed(30);
  for (let i = 0, n = 0; i < FIREFLIES * 8 && n < FIREFLIES / THIN; i++) {
    const [x, z] = disc(150), u = rnd(), up = rnd() < 0.12 ? rr(4, 13) : 0.7 + 4 * u * u, wr = rr(0.9, 2.4), sd = rnd(), per = rr(2.6, 6.5), sz = rr(0.04, 0.06);
    if (rnd() > 0.2 + 0.8 * near(x, z)) continue;
    const y = gy(x, z) + up, h = CAN - y;
    if (h < 6 || Dw(x, y, z) > 0 || gapAt(x + SUNX * h, z + SUNZ * h) > 0.1) continue;
    bubbles.push(x, y, z, wr, sd, per, sz, 0); n++;
  }
  // gnat swarms: on the slanted axis of the light shaft under a clearing (x, z, radius R), up metres above the floor
  rseed(31);
  const swarm = (gx, gz, R, up, n) => {
    const a = rnd() * TAU, q = sqrt(rnd()) * R * 0.35, rad = clamp(R * rr(0.08, 0.13), 0.3, 0.9), sd = rnd();
    const y = gy(gx - SUNX * 33, gz - SUNZ * 33) + up, h = CAN - y, x = gx - SUNX * h + cos(a) * q, z = gz - SUNZ * h + sin(a) * q;
    if (h < 3 || Dw(x, y, z) > 0) return;
    for (let i = 0; i < n; i++) bubbles.push(x, y, z, rad, rnd(), sd, rr(0.006, 0.011), 1);
  };
  for (const g of GAPS) for (let i = 0; i < SWARMS; i++) swarm(g[0], g[1], g[2], rr(2.5, 22), (SWARM / THIN) | 0);
  for (let i = GAPS.length; i < gaps.length; i++) {
    const g = gaps[i], u = rnd(), up = rr(3, 18);
    if (u < 0.15 + 0.85 * near(g[0], g[1])) swarm(g[0], g[1], g[2], up, (SWARM * 0.6 / THIN) | 0);
  }
  _seed = keepSeed;
  if (!bubbles.length) bubbles.push(0, -200, 0, 0, 0, 1, 0, 0);

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 12; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  // up / dn: how far (times the instance scale) a mesh reaches above / below its origin, for the culling boxes
  const packC = (L, up = 0, dn = 0) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - max(3, dn * a[i + 3])); hi[c] = max(hi[c], a[i + 1] + max(3, up * a[i + 3])); } }
    return { data, n, start, lo, hi };
  };
  // props: 0 pole trees, 1 hanging lianas, 2 liana swags, 3-4 shrubs, 5 logs
  const PUP = [1.05, 0, 0, 1.6, 1.6, 0], PDN = [0, 1.02, 0.5, 0, 0, 0];
  return { gy, glints: new Float32Array(glints), chunks: chunks.map((c) => packC(c)), props: props.map((p, i) => packC(p, PUP[i], PDN[i])), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, bubbles: new Float32Array(bubbles), volD, gm, fish: new Float32Array(fish), mantas: new Float32Array(mantas), snow };
}
// ---------------------------------------------------------------- procedural meshes
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--; // Low: a quarter of the triangles
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < 4; i++) { const q = qRand(); pl.push([q[0], q[1], q[2], rr(0.8, 0.98)]); const l = hypot(q[0], q[1], q[2]) || 1; pl[i][0] /= l; pl[i][1] /= l; pl[i][2] /= l; }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.9 + (det ? (fbm(x * 4 + sd, y * 4, z * 4, 2) - 0.5) * 0.25 : 0);
    let px = x * r, py = y * r * 0.8, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}
// big canopy tree, in metres: 30 m of trunk on buttress roots, then boughs. Placed at a scale that puts y = 34 on the
// canopy plane. tips = where the crown's leaf sprays go (bough ends and middles). Built once, cached: makeWorld needs
// the tips, main.js the mesh.
const TREES = [];
function treeMesh(v) {
  if (TREES[v]) return TREES[v];
  const keep = _seed; rseed(300 + v);
  const m = new Mesh(), lo = LV > 1, tips = [], H = 30, N = 10, R = 0.62, pts = [];
  const nrm = (d) => { const l = hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
  const lx = rr(-1, 1), lz = rr(-1, 1);
  for (let k = 0; k <= N; k++) { const t = k / N; pts.push([lx * t * t * 1.4 + sin(t * 5 + v) * 0.25, -1 + (H + 1) * t, lz * t * t * 1.4 + cos(t * 4 + v * 2) * 0.25]); }
  m.tube(pts, (k) => R * (1 - 0.5 * k / N) * (k === 0 ? 1.9 : k === 1 ? 1.2 : 1), lo ? 6 : 9, false, () => 1);
  // buttress roots: thin triangular fins with a concave outer edge
  const nf = 4 + (v & 1), bx = pts[0][0], bz = pts[0][2];
  for (let i = 0; i < nf; i++) {
    const a = i / nf * TAU + rr(-0.3, 0.3), c = cos(a), s = sin(a), w = rr(2.2, 3.4), h = rr(3.5, 5.5), tx = -s * 0.13, tz = c * 0.13;
    const P = [[0.3, -1.2], [w, -1.2], [w * 0.38, h * 0.22], [0.42, h]];
    const V = (j, sg) => m.v(bx + c * P[j][0] + tx * sg, P[j][1], bz + s * P[j][0] + tz * sg);
    for (const sg of [-1, 1]) { const q = [0, 1, 2, 3].map((j) => V(j, sg)); if (sg > 0) { m.tri(q[0], q[1], q[2]); m.tri(q[0], q[2], q[3]); } else { m.tri(q[0], q[2], q[1]); m.tri(q[0], q[3], q[2]); } }
    for (let j = 1; j < 3; j++) m.quad(V(j, 1), V(j, -1), V(j + 1, -1), V(j + 1, 1));
  }
  // boughs: one level of branching (the recursion of the coral builder)
  const br = (p, d, r, len, depth) => {
    const q = [p], n = depth ? 3 : 2; let e = p;
    for (let i = 0; i < n; i++) { d = nrm([d[0] + rr(-0.25, 0.25), d[1] + rr(-0.1, 0.2), d[2] + rr(-0.25, 0.25)]); e = [e[0] + d[0] * len / n, e[1] + d[1] * len / n, e[2] + d[2] * len / n]; q.push(e); }
    m.tube(q, (k) => r * (1 - 0.45 * k / n), lo ? 4 : 6, true, () => 1);
    if (!depth) { tips.push(e); return; }
    tips.push(q[2]);
    for (let i = 2 + (rnd() < 0.6); i > 0; i--) br(e, nrm([d[0] + rr(-0.9, 0.9), d[1] * 0.5 + rr(0.05, 0.5), d[2] + rr(-0.9, 0.9)]), r * 0.55, len * 0.72, depth - 1);
  };
  const nb = 5 + (v & 1);
  for (let i = 0; i < nb; i++) { const a = i / nb * TAU + rr(-0.35, 0.35); br(pts[i < 2 ? N - 2 : N], nrm([cos(a), rr(0.35, 0.8), sin(a)]), R * (i < 2 ? 0.3 : 0.4), rr(4.5, 7), 1); }
  _seed = keep; m.tips = tips;
  return TREES[v] = m;
}
// understorey tree, unit height: a thin trunk with a few branches near the top
function meshPole() {
  rseed(310);
  const m = new Mesh(), lo = LV > 1, N = 6, pts = [], at = (t) => [sin(t * N * 1.3) * 0.012, t, cos(t * N * 1.7) * 0.012];
  for (let k = 0; k <= N; k++) pts.push(at(k / N));
  m.tube(pts, (k) => 0.011 * (1 - 0.6 * k / N) * (k ? 1 : 1.7), lo ? 4 : 6, true, (k) => 0.5 + 0.5 * k / N);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + rr(0, 1), h = rr(0.5, 0.9), L = rr(0.12, 0.22), b = at(h);
    m.tube([b, [b[0] + cos(a) * L * 0.5, h + L * 0.3, b[2] + sin(a) * L * 0.5], [b[0] + cos(a) * L, h + L * 0.7, b[2] + sin(a) * L]], (k) => 0.0045 * (1 - 0.35 * k), lo ? 3 : 4, true, () => 1);
  }
  return m;
}
// lianas, unit size: 0 hangs from the origin down to y = -1 (two twisted strands), 1 sags between x = -0.5 and 0.5
function meshLiana(v) {
  rseed(320 + v);
  const m = new Mesh(), lo = LV > 1, N = lo ? 8 : 14;
  if (v) {
    const pts = [];
    for (let k = 0; k <= N; k++) { const x = k / N - 0.5; pts.push([x, -0.45 * (1 - 4 * x * x) + sin(k * 1.9) * 0.012, sin(k * 1.1) * 0.02]); }
    m.tube(pts, () => 0.008, lo ? 3 : 5, true, () => 1);
  } else for (let s = 0; s < 2; s++) {
    const pts = [], ph = rnd() * TAU, tw = rr(5, 9);
    for (let k = 0; k <= N; k++) { const t = k / N, r = 0.006 + 0.012 * sin(t * PI); pts.push([cos(ph + s * PI + t * tw) * r, -t, sin(ph + s * PI + t * tw) * r]); }
    m.tube(pts, () => 0.0035 - s * 0.001, lo ? 3 : 5, true, () => 1);
  }
  return m;
}
// fallen log, unit length along x
function meshLog() {
  rseed(330);
  const m = new Mesh(), N = 6, sides = LV > 1 ? 6 : 9, pts = [];
  for (let k = 0; k <= N; k++) pts.push([k / N - 0.5, sin(k * 2.1) * 0.006, cos(k * 1.3) * 0.006]);
  m.tube(pts, (k) => 0.07 * (1 - 0.25 * k / N) * (k ? 1 : 1.25), sides, true, (k) => 0.6 + 0.4 * sin(k / N * PI));
  const c = m.v(-0.5, 0, 0, 0.3);
  for (let s = 0; s < sides; s++) m.tri(c, (s + 1) % sides, s);
  return m;
}
function meshCoral(fan, lo = LV > 1) {
  rseed(200 + fan);
  const m = new Mesh();
  const nrm = (v) => { const l = hypot(...v) || 1; return v.map((c) => c / l); };
  const br = (p, d, r, len, depth) => {
    const pts = [p]; let q = p;
    for (let i = 0; i < 3; i++) { d = nrm([d[0] + rr(-0.3, 0.3), d[1] + rr(-0.1, 0.3), d[2] + (fan ? rr(-0.05, 0.05) : rr(-0.3, 0.3))]); q = [q[0] + d[0] * len / 3, q[1] + d[1] * len / 3, q[2] + d[2] * len / 3]; pts.push(q); }
    if (!depth) pts.push([q[0] + d[0] * r * 1.6, q[1] + d[1] * r * 1.6, q[2] + d[2] * r * 1.6]);
    if (lo) m.tube(depth ? [pts[0], pts[3]] : [pts[0], pts[3], pts[4]], (k) => (k > 1 ? r * 0.36 : r * (1 - 0.22 * k)) * 1.25, 3, true, (k) => clamp(1 - (depth + 1 - k) / 5, 0, 1));
    else m.tube(pts, (k) => k > 3 ? r * 0.36 : r * (1 - 0.22 * k / 3), fan ? 5 : 6, true, (k) => clamp(1 - (depth + 1 - k / 3) / 5, 0, 1));
    if (depth > 0) { const n = 2 + (rnd() < 0.5); for (let i = 0; i < n; i++) br(q, nrm([d[0] + rr(-0.8, 0.8), d[1] + rr(-0.1, 0.5), d[2] + (fan ? rr(-0.08, 0.08) : rr(-0.8, 0.8))]), r * 0.78, len * 0.8, depth - 1); }
  };
  const n0 = fan ? 1 : 2 + (rnd() * 2 | 0);
  for (let i = 0; i < n0; i++) br([rr(-0.08, 0.08), 0, rr(-0.08, 0.08)], nrm([rr(-0.5, 0.5), 1, fan ? 0 : rr(-0.5, 0.5)]), fan ? 0.06 : 0.08, fan ? 0.5 : 0.45, 3);
  return m;
}

// manta ray: span along x (half span = 1), nose +z; aux = span coordinate for the flap animation
function meshManta() {
  const m = new Mesh(), NU = 72, M = 22, rings = [];
  for (let j = 0; j <= NU; j++) {
    const u = j / NU * 2 - 1, au = abs(u);
    let zl = 0.52 - 0.74 * pow(au, 1.35) + 0.07 * exp(-pow((au - 0.13) / 0.05, 2)) - 0.05 * exp(-pow(au / 0.05, 2)) - 0.08 * pow(au, 5);
    const zt = -0.5 + 0.3 * pow(au, 0.8) + 0.02 - 0.08 * pow(au, 5);
    if (zl < zt + 0.004) zl = zt + 0.004;
    const th = 0.08 * pow(1 - au, 1.15) + 0.004 + 0.12 * exp(-pow(u / 0.2, 2)), ring = [];
    for (let k = 0; k < M; k++) { const a = k / M * TAU; ring.push(m.v(u, th * sin(a) * (0.62 + 0.38 * cos(a)), mix(zt, zl, 0.5 + 0.5 * cos(a)), u)); }
    rings.push(ring);
  }
  for (let j = 0; j < NU; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
  const tail = []; for (let i = 0; i <= 8; i++) tail.push([0, 0, -0.42 - i * 0.19]);
  const n0 = m.p.length / 3;
  m.tube(tail, (k) => 0.016 * (1 - k / 9), 4, true);
  for (let k = n0; k < m.aux.length; k++) m.aux[k] = 0;
  for (const sx of [-1, 1]) { // cephalic fins
    const n1 = m.p.length / 3;
    m.tube([[sx * 0.12, -0.02, 0.48], [sx * 0.135, -0.05, 0.6], [sx * 0.115, -0.09, 0.69], [sx * 0.085, -0.125, 0.74]], (k) => 0.045 * (1 - k / 4.4), 6, true);
    for (let k = n1; k < m.aux.length; k++) m.aux[k] = sx * 0.1;
  }
  return m;
}
function meshFish() {
  const m = new Mesh();
  const X = [0.5, 0.3, 0.05, -0.22, -0.34], H = [0.01, 0.13, 0.17, 0.09, 0.035], Wd = [0.01, 0.05, 0.065, 0.03, 0.012], rings = [];
  for (let i = 0; i < 5; i++) { const r = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; r.push(m.v(X[i], sin(a) * H[i], cos(a) * Wd[i])); } rings.push(r); }
  for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const k2 = (k + 1) % 6; m.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]); }
  const a = m.v(-0.33, 0, 0), b = m.v(-0.56, 0.2, 0), c = m.v(-0.47, 0, 0), d = m.v(-0.56, -0.2, 0);
  m.tri(a, b, c); m.tri(a, c, d);
  return m;
}
