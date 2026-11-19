// ============================================================================
// WGSL sources
// ============================================================================

// height of the canopy plane (the ocean's water surface was at 0). The forest floor is at about -48; the camera can
// rise to +2.4, which is as high as the collision grid goes.
const CAN = -15;

const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- terrain density (compute)
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn dens(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * .04 + 11., 3), fbm(p * .04 + 47., 3), fbm(p * .04 + 83., 3)) - .5;
  let q = p + w * vec3f(15., 6., 15.);
  // forest floor: gentle rises and hollows around -48
  let g0 = -48. + 5. * (fbm(vec3f(q.xz * .011, 3.), 4) - .5) + 1.4 * (fbm(vec3f(q.xz * .07, 9.), 3) - .5);
  let tn = 3. * (fbm(vec3f(q.xz * .09, 2.), 3) - .5);
  var dm = -1e3; var de = 1e3;
  var k = 0u;
  for (var i = 0u; i < u.c.x; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let yr = clamp((p.y - g0) / (b.y - g0), 0., 1.3);
    var e = seg2(q.xz, a.xy, a.zw) - b.x;
    e -= b.z * ss(.3, .92, yr) + 3. * (1. - yr) * (1. - yr) - b.w * ss(.0, .5, yr) * (1. - ss(.5, 1., yr));
    dm = smax(dm, smin(-e, b.y + tn - p.y, 3.), 2.5);
    de = min(de, e);
  }
  var clr = 0.;
  let kc = (u.c.x + u.c.y + u.c.z) * 2u;
  for (var i = 0u; i < u.c.w; i++) {
    let a = P[kc + i * 2u]; let b = P[kc + i * 2u + 1u];
    clr = max(clr, 1. - ss(0., b.y, seg2(q.xz, a.xy, a.zw) - b.x));
  }
  let rad = length(p.xz) + w.x * 14.;
  let n = fbm(vec3f(q.xz * .0125, 1.7), 4);
  let ring = ss(156., 172., rad);
  let plat = max(ss(.5, .565, n) * (1. - clr), ring);
  // low terraces instead of the ocean's plateaus; the rim wall still closes the world (cut off under the canopy below)
  let th = g0 + plat * mix(3. + 7. * fbm(vec3f(q.xz * .03, 5.), 2), 60., ring);
  var d = smax(g0 + 2.5 * ss(10., 0., de) - p.y, dm, 3.);
  d = smax(d, (th - p.y) * .7, 3.);
  k = u.c.x * 2u;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    var r = p + w * 3. - a.xyz;
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  let hg = p.y - g0;
  let rk = mix(.1, 1., ss(.8, 6., hg)); // soil on the floor is smooth, the outcrops keep their rock detail
  d += rk * ((.5 - wor(p * .17 + w * 2.)) * 3.4 + (.5 - wor(p * .41 + 7.)) * 1.3 + (fbm(p * .3, 3) - .5) * 2.2);
  d += rk * 2.2 * (abs(fract(p.y * .21 + w.y * 2.2) - .5) - .25);
  for (var i = 0u; i < u.c.z; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    d = smin(d, seg3(p + w * 2., a.xyz, b.xyz) - a.w, 2.);
  }
  // nothing solid within 5 m of the canopy plane or above it: the camera rises through free air
  return min(d, ${(CAN - 5).toFixed(1)} - p.y);
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (id.x == 0u || id.z == 0u || id.x == u.n.x - 1u || id.z == u.n.z - 1u || id.y == u.n.y - 1u) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// rock detail texture (tileable): rg = slope, b = height, a = mottling
// tileable noise (period `per` cells): value noise, fbm, worley
const W_PER = /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
`;
const W_DETAIL = W_NOISE + W_FS + W_PER + /*wgsl*/`
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// animated canopy texture (tileable; was the water texture): r = hole in the leaf cover, g = leaf noise,
// ba = slope of the leaf surface. Sampled along the sun (S_B cuv) it gives the sky holes, the floor dapples and the shafts.
const W_WATER = W_NOISE + W_FS + W_PER + /*wgsl*/`
@group(0) @binding(0) var<uniform> tm: vec4f;
fn lh(uv: vec2f) -> f32 { return tf(uv, 6., 4) * .6 + (1. - min(tw(uv * 14., 14.).x, 1.)) * .4; }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let u0 = fc.xy / ${WATER}.; let t = tm.x;
  // the crown layer sways a little as a whole (whole periods, so the texture still tiles)
  let uv = u0 + .003 * vec2f(sin(t * .6 + u0.y * 12.566371), cos(t * .45 + u0.x * 18.849556));
  let wq = uv + .04 * (vec2f(tf(uv, 4., 3), tf(uv + .5, 4., 3)) - .5);
  // holes: ragged blobs around some of the worley cell centres (HOLE_P of the cells, HOLE_R of a cell wide)
  let w = tw(wq * 8., 8.);
  let hole = (1. - ss(.15, .33, w.x + (tf(wq + 1.3, 16., 3) - .5) * .25)) * step(w.z, .42);
  let e = 1. / ${WATER}.;
  let s = vec2f(lh(uv + vec2f(e, 0.)) - lh(uv - vec2f(e, 0.)), lh(uv + vec2f(0., e)) - lh(uv - vec2f(0., e))) * (.03 / e);
  return vec4f(hole, tf(uv + 2.3, 8., 4), clamp(s, vec2f(-2.), vec2f(2.)));
}
`;

// ---------------------------------------------------------------- shared scene code
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f };
// ---- forest palette + haze: everything worth tuning is here
const CAN = ${CAN.toFixed(1)};               // height of the canopy plane
const FLR = -48.;                            // nominal forest floor
const HZ0 = .042;                            // haze extinction per metre at the floor
const HZB = .075;                            // how fast the haze thins with height (1/m)
const FARD = 150.;                           // geometry fades into the haze by here
// every light has a day (_D) and a night (_N) value; g.mis.w (0 day .. 1 night, eased in main.js) blends them, so the
// N key changes colours and intensities only: the sun direction, the shadow map and the world stay as they are
const HAZE_LO_D = vec3f(.105, .15, .095);    // haze colour on the floor
const HAZE_LO_N = vec3f(.012, .02, .035);
const HAZE_MID_D = vec3f(.19, .29, .14);     // haze colour under the canopy
const HAZE_MID_N = vec3f(.02, .035, .06);
const HAZE_HI_D = vec3f(.55, .76, 1.);       // haze colour above the canopy
const HAZE_HI_N = vec3f(.05, .09, .18);
const SKYC_D = vec3f(.14, .40, 1.1);         // zenith sky
const SKYC_N = vec3f(.02, .05, .16);
const SUNC_D = vec3f(1.75, 1.6, 1.3);        // direct sun / moonlight (same direction)
const SUNC_N = vec3f(.24, .32, .55);
const SHAFT_D = vec3f(1., .9, .6);           // tint of the light shafts
const SHAFT_N = vec3f(.4, .55, .95);
const RAYK_D = 4.5;                          // strength of the light shafts
const RAYK_N = 2.5;
const AMB_LO_D = vec3f(.90, 1., .66);        // skylight filtered by leaves (below the canopy)
const AMB_LO_N = vec3f(.14, .21, .38);
const AMB_HI_D = vec3f(.62, .80, 1.);        // open skylight (above the canopy)
const AMB_HI_N = vec3f(.16, .25, .50);
const MOON = vec3f(5., 5.6, 6.5);            // disc of the moon (the disc of the sun is 30 x SUNC_D)
fn ngt() -> f32 { return g.mis.w; }
fn hazeLo() -> vec3f { return mix(HAZE_LO_D, HAZE_LO_N, ngt()); }
fn hazeMid() -> vec3f { return mix(HAZE_MID_D, HAZE_MID_N, ngt()); }
fn hazeHi() -> vec3f { return mix(HAZE_HI_D, HAZE_HI_N, ngt()); }
fn skyc() -> vec3f { return mix(SKYC_D, SKYC_N, ngt()); }
fn sunc() -> vec3f { return mix(SUNC_D, SUNC_N, ngt()); }
fn shaftc() -> vec3f { return mix(SHAFT_D, SHAFT_N, ngt()); }
fn rayk() -> f32 { return mix(RAYK_D, RAYK_N, ngt()); }
fn ambLo() -> vec3f { return mix(AMB_LO_D, AMB_LO_N, ngt()); }
fn ambHi() -> vec3f { return mix(AMB_HI_D, AMB_HI_N, ngt()); }
const TAU = 6.2831853;
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
// 0 below the canopy, 1 above it
fn hk(y: f32) -> f32 { return ss(CAN - 3., CAN + 1., y); }
// haze density at height y, and its optical depth along a ray (closed form of the exponential profile)
fn hzd(y: f32) -> f32 { return HZ0 * exp(-HZB * (clamp(y, -60., 40.) - FLR)); }
fn hzt(ro: vec3f, rd: vec3f, d: f32) -> f32 {
  let x = clamp(HZB * rd.y * d, -6., 80.);
  var f = 1. - .5 * x;
  if (abs(x) > .01) { f = (1. - exp(-x)) / x; }
  return hzd(ro.y) * d * f;
}
fn hazeCol(y: f32) -> vec3f { return mix(mix(hazeLo(), hazeMid(), ss(FLR, CAN - 2., y)), hazeHi(), ss(CAN - 1., CAN + 5., y)); }
fn skyCol(rd: vec3f, sun: vec3f) -> vec3f {
  let mu = max(dot(rd, sun), 0.);
  return mix(hazeHi() * 1.5, skyc() * 1.5, pow(sat(rd.y), .45)) + sunc() * pow(mu, 14.) * .3 + mix(SUNC_D * 30., MOON, ngt()) * pow(mu, 1200.);
}
`;

const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tW: texture_2d<f32>;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow4(p: vec3f) -> f32 {
  let s = shUV(p); let e = 1.8 / ${SHADOW}.;
  return (textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shUV(p); let e = 2.1 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
// r = openness (terrain), g = skylight below the canopy / the baked clearings at and above it
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p - vec3f(-192., -56., -192.)) / vec3f(384., 60., 384.), 0.); }
// where the sun ray through p crosses the canopy plane: floor dapples, shafts and sky holes all use it, so they line up
fn cuv(p: vec3f) -> vec2f { return p.xz - g.sun.xz * ((p.y - CAN) / g.sun.y); }
// sun let through by the leaf cover: holes of the canopy texture at two scales + the baked clearings with ragged edges
fn gmix(a: vec4f, b: vec4f, c: f32) -> f32 { return sat(max(a.r, b.r * .85) + ss(.38, .62, c + (a.g - .5) * .5)); }
fn clr(q: vec2f) -> f32 { return vol(vec3f(q.x, CAN + 3., q.y)).g; }
fn gapF(q: vec2f) -> f32 { return gmix(textureSample(tW, sR, q / 31.), textureSample(tW, sR, q.yx / 73. + .37), clr(q)); }
fn gapL(q: vec2f, l: f32) -> f32 { return gmix(textureSampleLevel(tW, sR, q / 31., l), textureSampleLevel(tW, sR, q.yx / 73. + .37, l), clr(q)); }
// dappled sunlight (the caustics of the ocean): 1 in a sun fleck, 0 in leaf shade, all sun above the canopy
fn caus2(p: vec3f, d: f32) -> f32 { return mix(mix(gapF(cuv(p)), .14, ss(40., 110., d)), 1., hk(p.y)); }
fn caus(p: vec3f, d: f32) -> vec3f { return vec3f(caus2(p, d)); }
fn sunE(y: f32, z: f32) -> vec3f { return sunc(); }
fn amb(p: vec3f, n: vec3f, sky: f32, z: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return mix(ambLo() * (.3 + .7 * sky), ambHi(), hk(p.y)) * (.3 + .7 * up * up) + vec3f(.004, .008, .004);
}
fn zone(p: vec3f) -> f32 { return 0.; }
fn side(p: vec3f, n: vec3f, open: f32, z: f32) -> vec3f { return mix(ambLo() * .45, ambHi() * .6, hk(p.y)) * open * (1. - abs(n.y)) * .5; }
// height haze: transmittance from the closed-form optical depth, in-scatter in the colour of the layer the ray runs through
fn fogD(c: vec3f, wp: vec3f, far: f32) -> vec3f {
  let v = wp - g.cam.xyz; let d = max(length(v), 1e-3); let rd = v / d;
  let T = exp(-hzt(g.cam.xyz, rd, d)) * ss(far, far * .8, d);
  let hm = g.cam.y + rd.y * min(d, mix(22., 70., sat(-rd.y * 3.)));
  let mu = max(dot(rd, g.sun.xyz), 0.);
  let hc = hazeCol(hm) * mix(.5 + .5 * vol(g.cam.xyz + rd * min(d, 40.)).g, 1. + .6 * mu * mu, hk(hm));
  return c * T + hc * (1. - T);
}
fn fog(c: vec3f, wp: vec3f, z: f32) -> vec3f { return fogD(c, wp, FARD); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

// ---------------------------------------------------------------- solid meshes (terrain, rocks, set pieces, sponges, coral)
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  // trunks, lianas and shrubs shrink away where the haze swallows them (their leaves have gone by then)
  if (i.c.x > 1.5 && g.res.x > 0.) { sc *= 1. - ss(FARD * .8, FARD, distance(i.a.xyz, g.cam.xyz)); }
  var w = i.a.xyz + qrot(i.b, i.p * sc);
  w.y += sin(g.cam.w * .3 + i.c.y * 40.) * i.c.w;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let ts = select(1., i.m.z, mat >= 2);
  let A = tri(i.op, on, .1 * ts); let B = tri(i.op, on, .43 * ts); let C = tri(i.op, on, 1.9 * ts); let F = tri(i.op, on, 6.7 * ts); let fk = ss(10., 1.5, dist) * f32(mat <= 1);
  let Wd = textureSample(tD, sR, vec2f(i.op.x * .06, (i.op.y + i.op.z) * .7));
  let big = textureSample(tD, sR, i.op.xz * .013 + i.op.y * .021).a;
  let big2 = textureSample(tD, sR, i.op.zx * .031 + i.op.y * .043 + .37).a;
  var sgro = 0.;
  let sk = textureSample(tD, sR, vec2f((i.op.x + i.op.z) * .33, i.op.y * .035));
  let sk2 = textureSample(tD, sR, vec2f((i.op.x - i.op.z) * 1.1, i.op.y * .11));
  let gm = textureSample(tM, sC, i.wp.xz / 384. + .5);
  let ca = caus(i.wp, dist);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.7; var gloss = .1; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.;
  let flt = ss(.72, .93, n0.y);
  if (mat <= 1) {
    // rock (outcrops, boulders): grey-brown beds under moss and lichen
    let st = i.op.y * .55 + A.h * 1.6 + big * 5. + big2 * 3.;
    let bed = hs(floor(st)); let sf = fract(st);
    alb = mix(vec3f(.10, .10, .09), vec3f(.30, .27, .21), sat(A.c * 1.5 - .25));
    alb = mix(alb, mix(vec3f(.22, .16, .09), vec3f(.17, .18, .12), bed), ss(.42, .66, big) * .7);
    alb *= mix(.72, 1.15, bed) * (1. - .45 * ss(.12, .0, sf) * (1. - abs(on.y)));
    alb = mix(alb, vec3f(.42, .44, .36) * (.5 + .7 * C.h), ss(.60, .70, B.c * .6 + C.c * .5) * .45);
    let moss = ss(-.3, .5, n0.y) * ss(.28, .5, B.c * .55 + big * .5);
    alb = mix(alb, vec3f(.045, .15, .03) * (.5 + .9 * B.h), moss * .9);
    alb *= (.22 + 1.3 * hgt) * mix(1., .62 + .76 * F.h, fk);
    sgro = -ss(.14, .0, sf) * (1. - abs(on.y)) * 1.2;
    if (mat == 0) {
      // forest floor on the flat parts: dark soil, leaf litter, moss and seedling mats (gm.r), wet mud (gm.a)
      var fo = mix(vec3f(.075, .045, .026), vec3f(.17, .105, .05), B.h);
      fo = mix(fo, mix(vec3f(.24, .13, .045), vec3f(.36, .23, .08), C.c) * (.5 + .8 * C.h), ss(.30, .52, B.c * .6 + big2 * .5));
      fo = mix(fo, vec3f(.045, .17, .035) * (.5 + .9 * B.h), sat(gm.r * 1.2 - .45 + (B.c - .5) * 1.2) * .7);
      fo = mix(fo, vec3f(.045, .036, .028), gm.a * .6 * ss(.55, .35, A.h));
      alb = mix(alb, fo * (.55 + .7 * hgt) * mix(1., .62 + .76 * F.h, fk), flt);
      gloss = mix(gloss, .3, flt * gm.a * ss(.55, .35, A.h));
    }
  } else if (mat == 2) {
    // bark of the big trees: dark vertical fissures, pale lichen, moss towards the ground
    alb = mix(vec3f(.22, .17, .12), vec3f(.07, .05, .035), ss(.36, .64, sk.b * .6 + sk2.b * .5)) * (.7 + .5 * B.h);
    alb = mix(alb, vec3f(.36, .38, .30), ss(.60, .72, big2 * .6 + B.c * .5) * .5);
    alb = mix(alb, vec3f(.05, .15, .03) * (.6 + .8 * C.h), ss(.44, .64, A.c * .6 + big * .5) * ss(CAN, FLR + 4., i.wp.y) * .75);
    gloss = .12; bump = 1.3;
  } else if (mat == 3) {
    // lianas: dark fibrous wood
    alb = mix(vec3f(.10, .07, .04), vec3f(.26, .19, .10), Wd.b) * (.6 + .5 * B.h);
    alb = mix(alb, vec3f(.06, .14, .04), ss(.5, .7, A.c) * .5);
    gloss = .15; bump = .7;
  } else if (mat == 4) {
    // understorey trees and shrubs: smooth grey-green bark
    alb = mix(vec3f(.17, .16, .11), vec3f(.09, .13, .06), ss(.4, .6, A.c)) * (.6 + .6 * B.h);
    alb = mix(alb, vec3f(.34, .36, .28), ss(.62, .74, B.c * .6 + C.c * .5) * .4);
    vao = mix(.6, 1., i.ao); gloss = .15; bump = 1.;
  } else {
    // dead wood (fallen logs): pale and rotten, mossy on top
    alb = mix(vec3f(.12, .085, .05), vec3f(.25, .20, .13), B.h) * (.7 + .4 * C.h);
    alb = mix(alb, vec3f(.045, .15, .03) * (.5 + .9 * B.h), ss(.1, .7, n0.y) * ss(.35, .55, A.c * .6 + big * .5) * .9);
    vao = mix(.6, 1., i.ao); gloss = .1; bump = 1.4;
  }
  let rip = 0.;
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * bump + vec3f(.8, sgro, .35) * vec3f(rip, 1., rip))));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  let ao = (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45) * vao * ss(.12, .6, hgt);
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadow9(i.wp + n0 * .35);
  let ndl = sat(dot(N, L));
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z)) * ao;
  // direct sun only where the canopy lets it through (ca); a trace of it leaks everywhere
  let dl = E * ndl * (.012 + mix(vec3f(.12), ca, ss(.1, .45, dot(n0, L))) * 1.6);
  var c = alb * (dl + am) + emi + alb * flu * dot(dl + am, vec3f(.1, .5, .5));
  let H = normalize(V + L);
  c += E * ca * pow(sat(dot(N, H)), mix(10., 70., gloss)) * gloss * ndl * 1.8;
  c += (amb(i.wp, reflect(-V, N), v1.g, z) + side(i.wp, reflect(-V, N), sat((v2.r - .5) * 2.7), z)) * ao * (.08 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- leaves (kelp, grasses, ground cover)
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f,
  @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f };
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let ph = dot(p, vec2f(.031, .017));
  let a = .024 * pow(max(h, 0.), 1.25);
  return a * (vec2f(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * vec2f(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
// firefly / sunlit insect colours of the glints
fn pal(h: f32) -> vec3f {
  if (h < .3) { return vec3f(1., .62, .08); }
  if (h < .6) { return vec3f(.45, 1., .12); }
  if (h < .8) { return vec3f(1., .9, .5); }
  return vec3f(.9, 1., .6);
}
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = sin(f32(vi >> 1u) / (ROWS - 1.) * 1.5708);
  let ty = i32(i.c.x * 255. + .5); let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w;
  let len = i.a.w; let hA = i.b.w;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  // per type: x sparkle prob, y translucency, z iridescence, w emissive
  // ruf: ruffled edge (kelp had 1). Leaves are stiff: little travelling wave (wav) and flutter (fls)
  var col = vec3f(0.); var pr = vec4f(0.); var spc = vec3f(0.); var shp = vec2f(.75, .7); var wav = .25; var fls = .5; var ruf_ = .25;
  let hsel = hs(s1 * 13.7 + s2 * 71.3);
  switch ty {
    // 0 broad leaf sprays: tree crowns, shrubs, the canopy
    case 0 { col = mix(vec3f(.035, .13, .022), vec3f(.075, .20, .03), s1); col = mix(col, vec3f(.13, .19, .03), step(.93, s2));
 pr = vec4f(.03, .9, 0., 0.); spc = vec3f(.9, 1., .8); shp = vec2f(.62, .55); }
    // 1 thin stems: hanging vines and aerial roots (never thinned out)
    case 1 { col = vec3f(.09, .075, .04); pr = vec4f(0., .2, 0., 0.); shp = vec2f(.05, .1); fls = .3; ruf_ = 0.; }
    // 2 fern fronds
    case 2 { col = mix(vec3f(.04, .17, .03), vec3f(.09, .26, .04), s1); pr = vec4f(0., 1., 0., 0.); shp = vec2f(.7, .9); wav = .35; fls = .6; ruf_ = .6; }
    // 3 big dark blades of the understorey (heliconia, young palms), wet and glinting
    case 3 { col = mix(vec3f(.02, .09, .025), vec3f(.04, .14, .03), s1); pr = vec4f(.06, .8, 0., 0.); spc = vec3f(.8, 1., .9); shp = vec2f(.55, .45); wav = .2; fls = .4; }
    // 4 dead leaves: the litter on the floor
    case 4 { col = mix(vec3f(.17, .09, .03), vec3f(.26, .17, .05), s1); col = mix(col, vec3f(.10, .06, .03), step(.7, s2)); pr = vec4f(0., .5, 0., 0.); shp = vec2f(.6, .6); wav = .1; fls = .2; }
    // 5 moss and seedlings
    case 5 { col = mix(vec3f(.04, .16, .025), vec3f(.09, .24, .04), s1); pr = vec4f(0., .9, 0., 0.); shp = vec2f(.6, .6); wav = .3; fls = .6; }
    // 6 hanging moss and epiphyte strands
    case 6 { col = mix(vec3f(.07, .15, .06), vec3f(.12, .19, .08), s1); pr = vec4f(0., 1., 0., 0.); shp = vec2f(.4, .3); wav = .8; fls = .8; ruf_ = .5; }
    // 7 flowers: heliconia reds and oranges, a few orchid pinks
    default { col = mix(vec3f(.75, .08, .05), vec3f(.90, .45, .04), s1); col = mix(col, vec3f(.60, .12, .50), step(.7, s2)); pr = vec4f(0., .9, 0., .05); spc = vec3f(1., .6, .5); shp = vec2f(.5, .5); }
  }
  pr.x = step(hs(s1 * 91.7 + s2 * 37.1 + i.b.x), pr.x);
  let k = (i.c.w - .3) * 2.0 + sin(t * (.8 + s1) * fls + s2 * 40. + hA * .25) * .10 * fls;
  let wph = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  let wv = sin(wph) * .12 * wav;
  let kq = k * 1.7; let ka = select(kq, .06, abs(kq) < .06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = i.a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  let sl = sK + wv + cos(wph) * .10 * wav * v * (3. + 5. * s2);
  let N = normalize(pe * cK - d * sl); let T0 = normalize(d * cK + pe * sl);
  let tw = (s1 - .5) * 2.4 * v + sin(t * .9 + s2 * 20.) * .25 * v;
  let S = sd * cos(tw) + N * sin(tw); let N2 = N * cos(tw) - sd * sin(tw);
  let shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.), shp.y);
  let shp_ = g.res.x == 0.;
  let cd = distance(i.a.xyz, g.cam.xyz); let far = FAR * g.mis.z;
  let nearK = select(1. - ss(26., 40., cd), 0., shp_);
  let farK = select((1. - ss(far * .8, far, cd)) * ss(.6, 2.2, distance(c, g.cam.xyz)) * ss(len * 1.1 + .5, len * 2.2 + 1.2, distance(i.a.xyz + d * (len * .5), g.cam.xyz)), 1., shp_);
  let ruf = sin(v * 10. + s2 * 30. + t * .6) * i.b.z * .36 * u * shape2(v) * nearK * ruf_;
  var p = c + S * (u * farK * select(i.b.z * .5 * shape, select(max(i.b.z * .5, .09) * shape, 0., ty == 1), shp_));
  p += N2 * ruf;
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = g.vp * vec4f(p, 1.); o.wp = p; o.n = normalize(N2 + S * u * .55 - T0 * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK * ruf_); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2); o.spc = spc;
  return o;
}
struct GO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsGl(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> GO {
  var o: GO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w;
  var p = a.xyz; let sw = sway(a.xz, a.w, t); p.x += sw.x; p.z += sw.y;
  p += .1 * vec3f(sin(t * .7 + b.x * 50.), sin(t * .9 + b.x * 70.), cos(t * .8 + b.x * 90.));
  let d = length(p - g.cam.xyz);
  if (d > 90. || dot(p - g.cam.xyz, g.fwd.xyz) < -1.) { o.cp = vec4f(0., 0., 2., 1.); return o; }
  let tw = pow(.5 + .5 * sin(t * (.35 + .9 * hs(b.x)) + b.x * 100.), 4.);
  let sz = min(max(b.z, d * .0026), d * .0045);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q;
  let z = zone(p);
  // fireflies glow on their own in the shade and flare where the sun catches them
  let lit = .35 + 1.6 * mix(1., .3, ngt()) * shadow1(p) * mix(gapL(cuv(p), 1.5), 1., hk(p.y));
  let e = b.z / sz;
  o.col = pal(b.y) * (.12 + tw * 1.7) * lit * e * e * exp(-hzd(p.y) * d) * ss(.4, 1.5, d) * 17.;
  return o;
}
@fragment fn fsGl(i: GO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  return vec4f(min(i.col * exp(-r * 7.) * (1. - ss(.7, 1., r)), vec3f(10.)), 0.);
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus2(i.wp, dist);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let z = zone(i.wp);
  let lt = textureSample(tD, sR, vec2f(i.uv.x * .13 + i.sd.x * 3.7, i.uv.y * .8 + i.sd.y * 5.3));
  let vv = vol(i.wp + vec3f(0., .8, 0.));
  let E = sunE(i.wp.y, z) * shadow1(i.wp + L * .3);
  let ndl = dot(n, L);
  var alb = i.col * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * mix(.5, 1.12, i.uv.y) * (1. - .45 * ss(30., 8., dist) * ss(.6, 1., sin(i.uv.y * 40. - abs(i.uv.x) * 7. + i.sd.x * 40.))) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + i.sd.x * .22 + i.uv.y * .5 + .55));
  alb = mix(alb, alb * .5 + ir * vec3f(.15, .13, .30), i.pr.z * (1. - ndv) * .8);
  let tr = (max(-ndl, 0.) * .85 + .15) * i.pr.y;
  let trc = alb * mix(vec3f(1.), vec3f(1.5, 1.4, .75), sat(i.pr.y) * (1. - i.pr.z));
  let aov = sat((vv.r - .5) * 6.) * mix(.4, 1., i.uv.y);
  let am = (amb(i.wp, n, vv.g, z) + amb(i.wp, -n, vv.g, z) * i.pr.y * .55 * vec3f(1.1, 1.15, .7) + side(i.wp, n, sat((vv.r - .5) * 4.), z) * .6) * (.3 + .7 * aov);
  var c = E * (.012 + ca * 1.6) * (alb * max(ndl, 0.) + trc * tr) + alb * am;
  let H = normalize(V + L);
  c += E * ca * (pow(sat(dot(n, H)), 40.) * (.3 + ir * i.pr.z * 2.) + pow(sat(dot(n, H)), 9.) * .07) + am * ir * i.pr.z * pow(1. - ndv, 3.) * 1.5;
  c += E * ca * trc * i.pr.y * pow(sat(dot(-V, L)), 3.) * 1.2;
  c += alb * i.pr.w * (.5 + 3. * dot(am + E * .3, vec3f(.1, .5, .5)));
  // sparkle: whole-leaf glints that twinkle slowly
  let tw = pow(.5 + .5 * sin(g.cam.w * (.5 + i.sd.y * 1.4) + i.sd.x * 90.), 5.);
  let m = ss(.2, .0, abs(i.uv.y - (.35 + .45 * i.sd.y))) * (1. - i.uv.x * i.uv.x);
  let lit = .1 + E.g * ca * 1.2;
  c += i.spc * i.pr.x * (.1 + tw) * m * lit * .6;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- butterflies (vsFish) + birds (vsManta)
const W_ANIM = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32 };
@vertex fn vsFish(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let h = vec3f(hs(s), hs(s + .37), hs(s + .71));
  let R = i.a.w; let t = g.cam.w;
  // surging speed along the orbit: a time warp whose rate stays positive (1 - .45 * 1.1 - .15 * 2.3 = .16), so the
  // insect lurches forward and stalls but never flies backwards
  let tw = t + .45 * sin(t * 1.1 + s * 20.) + .15 * sin(t * 2.3 + s * 47.);
  let ta = tw * i.b.y + i.b.w * 6.3 + (h.x - .5) * (26. / R);
  let ph = i.b.w * 17.;
  let P = i.a.xyz + vec3f(R * cos(ta), 2.2 * sin(3. * ta + ph), R * .6 * sin(ta));
  let T0 = normalize(vec3f(-R * sin(ta), 6.6 * cos(3. * ta + ph), R * .6 * cos(ta))) * sign(i.b.y);
  let S0 = normalize(cross(vec3f(0., 1., 0.), T0)); let U0 = cross(T0, S0);
  // the body yaws about the flight direction instead of tracking it
  let T = normalize(T0 + S0 * (.4 * sin(t * 2.9 + s * 33.) + .2 * sin(t * 6.1 + s * 71.)));
  let S = normalize(cross(vec3f(0., 1., 0.), T)); let Up = cross(T, S);
  // wingbeat: 6 - 8.4 Hz per individual, with short glides on raised wings (fl = 0)
  let fp = t * (38. + 15. * h.x) + s * 50.;
  let fl = ss(-.6, -.25, sin(t * (1.1 + h.y) + s * 90.));
  // erratic flight: a bouncing bob (|sin| kicks upward), two faster wobbles, sideways jitter, and the body dropping
  // as the wings rise
  let bob = .3 * (abs(sin(t * 2.1 + s * 61.)) - .64) + .14 * sin(t * 4.3 + s * 23.) + .06 * sin(t * 7.9 + s * 91.) - .025 * fl * sin(fp);
  let jit = .28 * sin(t * 3.1 + s * 77.) + .12 * sin(t * 6.7 + s * 13.);
  let off = S0 * ((h.y - .5) * 5. + sin(t * .6 + s * 40.) * .5 + jit) + U0 * ((h.z - .5) * 3.2 + cos(t * .5 + s * 31.) * .4) + vec3f(0., bob, 0.);
  var l = i.p * i.b.z * (.75 + .5 * h.z);
  // flap: rotate each wing about the body axis (mesh x). aux = signed distance from the axis: its sign mirrors the
  // two sides, its size delays the tip, and the hindwing (x < 0) trails the forewing. 0 on the body: no rotation.
  let d = abs(i.n.w);
  let th = sign(i.n.w) * (.3 + fl * sin(fp - d * .7 + i.p.x * 1.2));
  let cs = cos(th); let sn = sin(th);
  l = vec3f(l.x, l.y * cs + l.z * sn, l.z * cs - l.y * sn);
  let n = vec3f(i.n.x, i.n.y * cs + i.n.z * sn, i.n.z * cs - i.n.y * sn);
  let w = P + off + T * l.x + Up * l.y + S * l.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = T * n.x + Up * n.y + S * n.z; o.op = i.p; o.sd = s;
  o.lt = shadow1(w);
  return o;
}
@fragment fn fsFish(i: VO) -> @location(0) vec4f {
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  // the wings are single sheets drawn unculled: light the side that is seen
  let ng = normalize(i.n); let fr = dot(ng, V); let n = ng * select(-1., 1., fr >= 0.);
  let z = zone(i.wp); let vv = vol(i.wp);
  // morpho blue, a few yellow and orange ones; black outer margin and body, dull brown undersides, so the colour
  // flashes on and off with the wingbeat
  let hue = fract(i.sd * 7.7); let az = abs(i.op.z);
  var alb = vec3f(.04, .22, .95);
  if (hue > .6) { alb = vec3f(.95, .70, .08); }
  if (hue > .85) { alb = vec3f(.95, .30, .05); }
  let rim = max(ss(.6, .88, az), ss(-.28, -.46, i.op.x));
  alb = mix(alb, vec3f(.02, .03, .06), rim);
  alb = mix(alb, vec3f(.13, .085, .05) * (1. - .5 * rim), .9 * step(fr, 0.));
  alb = mix(alb, vec3f(.025, .02, .02), ss(.06, .035, az));
  let E = sunE(i.wp.y, z) * i.lt * caus2(i.wp, length(i.wp - g.cam.xyz));
  var c = alb * (E * (.25 + .75 * abs(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.3);
  c += E * pow(sat(dot(n, normalize(V + L))), 24.) * .8;
  return fin(fog(c, i.wp, z));
}
@vertex fn vsManta(i: VI) -> VO {
  var o: VO;
  let t = g.cam.w; let R = i.a.w; let sz = i.b.z;
  let ta = t * i.b.y + i.b.x;
  let P = i.a.xyz + vec3f(R * cos(ta), 2.5 * sin(2. * ta + i.b.w), R * .75 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 5. * cos(2. * ta + i.b.w) * 1., R * .75 * cos(ta))) * sign(i.b.y);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  let bank = -.28 * sign(i.b.y) + .07 * sin(t * .43 + i.b.w * 30.);
  let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  let u = i.n.w; let au = abs(u);
  // a burst of about five wingbeats, then a long glide on slightly raised wings: fe is the flap envelope over a
  // 7 - 11 s cycle per bird. The phase runs on regardless, so the envelope only scales the amplitude.
  let cy = fract(t / (7. + 4. * i.b.w) + i.b.x);
  let fe = ss(0., .05, cy) * ss(.3, .22, cy);
  // flap: y = fe * A * au^PW * sin(w t - LAG * au) + DI * au^1.5, the phase delayed along the span so the beat
  // travels outward; sl = dy/du, differentiated from the same constants, tilts the normal
  const A = .24; const PW = 1.25; const LAG = .55; const DI = .09;
  let f0 = t * 15. + i.b.w * 5.; let fp = f0 - au * LAG;
  var l = i.p;
  l.y += fe * A * pow(au, PW) * sin(fp) + DI * pow(au, 1.5) - fe * .03 * sin(f0);
  let sl = (fe * A * (PW * pow(au, PW - 1.) * sin(fp) - LAG * pow(au, PW) * cos(fp)) + DI * 1.5 * sqrt(au)) * sign(u);
  let ln = normalize(vec3f(i.n.x - sl * i.n.y, i.n.y + sl * i.n.x, i.n.z));
  let w = P + (S * l.x + Up * l.y + T * l.z) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = S * ln.x + Up * ln.y + T * ln.z; o.op = i.p; o.sd = i.b.w;
  o.lt = 1.;
  return o;
}
@fragment fn fsManta(i: VO) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus(i.wp, dist);
  let tx = textureSample(tD, sR, i.op.xz * .9 + i.sd);
  let n = normalize(i.n + (vec3f(tx.r, 0., tx.g) - vec3f(.5, 0., .5)) * .5); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let top = ss(-.2, .25, normalize(i.n).y);
  let au = abs(i.op.x);
  // soaring birds: dark above, paler below, dark flight feathers toward the wing tips
  var belly = vec3f(.16, .13, .10) * (.6 + .6 * tx.b);
  belly = mix(belly, vec3f(.05, .04, .035), sat(ss(.45, .9, au + tx.a * .35)));
  var back = vec3f(.045, .035, .03) + vec3f(.08, .06, .04) * ss(.5, .75, tx.a);
  var alb = mix(belly, back, top);
  let E = sunE(i.wp.y, z) * shadow4(i.wp + n * .3);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + tx.a * 1.5 + .55));
  let fillN = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  var c = alb * (E * sat(dot(n, L)) * (.3 + ca) + amb(i.wp, fillN, vv.g, z) * 1.1 + side(i.wp, n, 1., z) * .8);

  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * .5 * (.3 + ca);
  let sky = amb(i.wp, vec3f(0., 1., 0.), vv.g, z);
  c += alb * sky * ca * .45 * (1. - top) + sky * pow(1. - ndv, 3.) * .35;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- water surface seen from below
const W_SURF = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = vec3f(g.cam.x + p.x * 900., CAN, g.cam.z + p.y * 900.);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let v = i.wp - g.cam.xyz; let d = max(length(v), 1e-3); let V = v / d;
  let q = i.wp.xz;
  let a = textureSample(tW, sR, q / 31.); let b = textureSample(tW, sR, q.yx / 73. + .37);
  let big = textureSample(tW, sR, q / 211. + .61);
  let f1 = textureSample(tW, sR, q / 6.7 + .13); let f2 = textureSample(tW, sR, q.yx / 2.9 + .51);
  let gp = gmix(a, b, clr(q));
  // nearby holes are real holes: the sky shows through from below, the forest from above
  if (gp > .5 && d < 240.) { discard; }
  let L = g.sun.xyz;
  var c = vec3f(0.);
  if (g.cam.y < CAN) {
    // underside: a dark leaf mass, glowing green where it is thin (around the holes)
    let thin = sat(gp * 1.6 + a.g * .4 - .2);
    c = mix(vec3f(.010, .028, .008), vec3f(.09, .24, .04), thin * thin) * (.6 + .8 * big.g) * (.5 + f1.g) * sunc().g;
    c += amb(i.wp, vec3f(0., -1., 0.), vol(i.wp - vec3f(0., 4., 0.)).g, 0.) * vec3f(.05, .11, .03);
  } else {
    // top: what shows between the crowns' own leaves. Darker than them, mottled at leaf scale, dark towards the holes
    let s = (a.ba + b.ba * .7 + (f1.ba * 1.2 + f2.ba) * ss(90., 20., d)) * ss(320., 50., d);
    let n = normalize(vec3f(-s.x, 1., -s.y));
    let alb = mix(vec3f(.02, .07, .012), vec3f(.07, .17, .028), sat(a.g * .5 + f1.g * .7 + big.g * .4 - .25)) * (.55 + .9 * f2.g);
    c = alb * (sunc() * sat(dot(n, L)) * 1.6 * (1. - .75 * max(f1.r, f2.r) * ss(120., 30., d)) + amb(i.wp, n, 1., 0.)) * (1. - .85 * ss(.1, .5, gp));
    c += sunc() * alb * pow(sat(dot(n, normalize(L - V))), 24.) * .5;
  }
  return fin(fogD(c, i.wp, 1e5));
}
// behind everything: the sky seen through the haze (bright above the canopy and through its holes, haze-coloured below)
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
// ---- stars: everything worth tuning is here
const ST_N = 90.;                            // grid cells from the zenith to the horizon (about 25000 cells in the sky)
const ST_FILL = .16;                         // share of the cells that hold a star
const ST_GAIN = 5.;                          // brightest star (HDR); most are far dimmer
const ST_PX = 1.3;                           // smallest radius in pixels, so a star never falls between them
fn h22(p: vec2f) -> vec2f { var q = fract(p.xyx * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// One hashed point per cell of a stereographic map of the upper hemisphere (conformal: stars stay round, and
// 1 + rd.y >= 1 so nothing divides by zero). rd.y > 0 only.
fn stars(rd: vec3f) -> vec3f {
  let k = ST_N / (1. + rd.y);
  let p = rd.xz * k; let c = floor(p);
  let h = h22(c); let h2 = h22(c + 71.3);
  if (h2.x > ST_FILL) { return vec3f(0.); }
  // radius: at least ST_PX pixels of the render target (g.up.w = tan of half the view, g.res.w = 1 / height)
  let r = min(max(.0011, ST_PX * 2. * g.up.w * g.res.w) * k, .15);
  let v = (p - c - (.15 + .7 * h)) / r;
  let b = h2.x / ST_FILL;
  let tw = .75 + .25 * sin(g.cam.w * (1.5 + 4. * h2.y) + h.x * 90.);
  return mix(vec3f(.65, .78, 1.), vec3f(1., .9, .72), h.y) * (ST_GAIN * (.06 + .94 * b * b * b * b) * tw * exp(0. - dot(v, v) * 2.5) * ss(0., .1, rd.y));
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  let rd = normalize(i.wp - g.cam.xyz);
  let T = exp(-hzt(g.cam.xyz, rd, 900.));
  let hm = g.cam.y + rd.y * mix(22., 70., sat(-rd.y * 3.));
  let hc = hazeCol(hm) * mix(.5 + .5 * vol(g.cam.xyz + rd * 40.).g, 1., hk(hm));
  var sk = skyCol(rd, g.sun.xyz);
  // night only, and only above the horizon: by day this costs one branch
  if (ngt() > 0. && rd.y > 0.) { sk += stars(rd) * ngt() * ngt(); }
  return fin(sk * T + hc * (1. - T));
}
`;

// ---------------------------------------------------------------- sprites: insects and drifting particles (additive)
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.; }
// ---- insects (the pass that drew the ocean's bubbles): everything worth tuning is here
const FF_COL = vec3f(.62, 1., .16);          // firefly light, warm yellow-green (some lean towards FF_COL2)
const FF_COL2 = vec3f(1., .78, .18);
const FF_GAIN = 9.;                          // brightness of a flash at its peak (HDR: it feeds the bloom)
const FF_GAIN_N = 25.;                       // ... and at night, when they carry the scene
const FF_POW = 12.;                          // sharpness of the flash: higher = dark for more of the period
const FF_SUN = .88;                          // how much of their light the sun drowns in a shaft or a sun fleck
const FF_SUN_N = .15;                        // ... the moon drowns next to none
const FF_HAZE = .4;                          // share of the haze extinction they suffer (1 = like a lit surface)
const FF_FAR = 110.;                         // not drawn beyond this (m)
const GN_GAIN = 3.;                          // gnat in full shaft light
const GN_GAIN_N = .5;                        // ... in a moonbeam (on top of the moon being dim): they all but vanish
const GN_DRIFT = 1.8;                        // how far a swarm's centre wanders, in swarm radii
const GN_JIT = .04;                          // fast jitter of each gnat (m), at 4 to 7 Hz
const GN_FAR = 70.;                          // gnats fade out by here (m)
// instance: a = position + radius, b = seed, period (firefly) or swarm seed (gnat), size, type (0 firefly, 1 gnat).
// Both are a closed form of time; the light is taken at the insect, once per vertex, and the blend is additive
// (alpha 0 into the premultiplied blend of this pass).
@vertex fn vsBug(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w; let s = b.x;
  o.cp = vec4f(0., 0., 2., 1.); o.uv = q; o.wp = a.xyz; o.pr = vec4f(0.);
  let h = vec3f(hs(s), hs(s + .37), hs(s + .71));
  let fly = b.w < .5;
  var p = a.xyz; var bl = 1.;
  if (fly) {
    // firefly: dark most of the time, a soft flash once per period, and whole minutes of rest now and then
    let f = .6 + .8 * h;
    bl = pow(max(.5 + .5 * sin(t * TAU / max(b.y, .5) + s * 100.), 0.), FF_POW) * ss(-.3, .3, sin(t * .05 * f.x + s * 211.));
    if (bl < .004) { return o; }
    // aimless drift: two slow sines per axis, each at its own rate
    p += a.w * .67 * vec3f(sin(t * .11 * f.x + s * 40.) + .5 * sin(t * .29 * f.y + s * 91.),
      .22 * (sin(t * .17 * f.z + s * 63.) + .5 * sin(t * .41 * f.x + s * 17.)),
      sin(t * .13 * f.y + s * 77.) + .5 * sin(t * .23 * f.z + s * 29.));
  } else {
    // gnat: the swarm centre drifts slowly, each gnat loops around it and jitters fast
    let sw = b.y; let hc = vec3f(hs(sw), hs(sw + .37), hs(sw + .71));
    let wv = 1.2 + 2.6 * h;
    p += GN_DRIFT * a.w * vec3f(sin(t * .13 * (.6 + hc.x) + sw * 50.), .4 * sin(t * .19 * (.6 + hc.y) + sw * 70.), cos(t * .11 * (.6 + hc.z) + sw * 90.));
    p += a.w * (.25 + .75 * hs(s + .13)) * vec3f(sin(t * wv.x + s * 300.), .7 * sin(t * wv.y + s * 500.), cos(t * wv.z + s * 700.));
    p += GN_JIT * vec3f(sin(t * 31. * (.7 + .6 * h.y) + s * 900.), sin(t * 27. * (.7 + .6 * h.z) + s * 1100.), cos(t * 37. * (.7 + .6 * h.x) + s * 1300.));
  }
  let v = p - g.cam.xyz; let d = max(length(v), 1e-3);
  if (d > FF_FAR || dot(v, g.fwd.xyz) < 0. - 1.) { return o; }
  let sun = shadow1(p) * mix(gapL(cuv(p), 2.), 1., hk(p.y));
  var sz = b.z; var col = vec3f(0.); var k = 7.;
  if (fly) {
    // emissive: brightest in the shade, and the haze only takes a part of it
    sz = max(b.z, d * .003);
    col = mix(FF_COL, FF_COL2, .5 * h.z) * (mix(FF_GAIN, FF_GAIN_N, ngt()) * bl * (1. - mix(FF_SUN, FF_SUN_N, ngt()) * sun) * (b.z / sz) * exp(0. - hzd(p.y) * d * FF_HAZE));
  } else {
    // not emissive: sunlight caught in a shaft (brighter against the light), next to nothing outside it
    if (sun < .02 || d > GN_FAR) { return o; }
    sz = max(b.z, d * .0011);
    let mu = max(dot(v / d, g.sun.xyz), 0.);
    col = sunc() * shaftc() * (mix(GN_GAIN, GN_GAIN_N, ngt()) * sun * (1. + 2. * mu * mu * mu * mu) * (.6 + .8 * h.x) * (b.z / sz) * exp(0. - hzd(p.y) * d) * ss(GN_FAR, GN_FAR * .65, d));
    k = 3.;
  }
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.wp = p;
  o.pr = vec4f(col * ss(.3, 1.2, d), k);
  return o;
}
@fragment fn fsBug(i: VO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  // the ceiling rises with the night gain, or the brightest flashes would clip to a flat yellow
  return vec4f(min(max(i.pr.rgb * exp(0. - r * i.pr.w) * (1. - ss(.7, 1., r)), vec3f(0.)), vec3f(mix(12., 30., ngt()))), 0.);
}
// pollen and insects: they only show where the sun reaches them, so they trace the light shafts
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let B = 44.;
  var p = a.xyz * B + vec3f(t * .16, t * .04, t * .11) + .5 * vec3f(sin(t * .3 + a.x * 60.), sin(t * .23 + a.y * 50.), cos(t * .27 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = max(length(p - g.cam.xyz), 1e-3);
  let sz = (.012 + .04 * a.w * a.w * a.w);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0011);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011));
  let tw = .6 + .4 * sin(t * (1. + a.w * 2.) + a.x * 100.);
  let sun = shadow1(p) * mix(gapL(cuv(p), 2.), .1, hk(p.y));
  o.pr = vec4f(fade * tw, sun, a.w, d);
  return o;
}
@fragment fn fsSnow(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = ss(1., .2, r);
  let c = (sunc() * shaftc() * i.pr.y * 1.3 + amb(i.wp, vec3f(0., 1., 0.), vol(i.wp).g, 0.) * .05) * mix(vec3f(1.), vec3f(1., .85, .5), i.pr.z);
  return vec4f(min(max(c * m * m * i.pr.x * exp(-hzd(i.wp.y) * i.pr.w), vec3f(0.)), vec3f(8.)), 0.);
}
`;

// ---------------------------------------------------------------- volumetric light shafts (half res)
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tW: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var sC: sampler;
fn vuv(p: vec3f) -> vec3f { return (p - vec3f(-192., -56., -192.)) / vec3f(384., 60., 384.); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  let ro = g.cam.xyz; let sx = g.sun.xyz;
  // shafts only exist below the canopy: march the part of the ray that is under it (at most 80 m: the haze hides the rest)
  var t1 = min(zl * rl, 80.); var t0 = 0.;
  if (ro.y > CAN) { t0 = t1; if (rd.y < -1e-3) { t0 = min((CAN - ro.y) / rd.y, t1); } }
  else if (rd.y > 1e-3) { t1 = min(t1, (CAN - ro.y) / rd.y); }
  let dt = (t1 - t0) / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = 0.; var tau = hzt(ro, rd, t0);
  for (var n = 0; n < ${RAYN}; n++) {
    let p = ro + rd * (t0 + (f32(n) + j) * dt);
    let s = g.sm * vec4f(p, 1.);
    let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0006);
    // the same canopy mask as the surfaces use (S_B gmix), a little blurred
    let q = p.xz - sx.xz * ((p.y - CAN) / sx.y);
    let a = textureSampleLevel(tW, sR, q / 31., 2.5); let b = textureSampleLevel(tW, sR, q.yx / 73. + .37, 2.);
    let c = textureSampleLevel(tV, sC, vuv(vec3f(q.x, CAN + 3., q.y)), 0.).g;
    let gp = sat(max(a.r, b.r * .85) + ss(.38, .62, c + (a.g - .5) * .5));
    let mist = sat(1. - (textureSampleLevel(tV, sC, vuv(p), 0.).r - .5) * 3.4);
    let sg = hzd(p.y);
    acc += exp(-tau) * vis * gp * (sg + .006) * (1. + .8 * mist * mist);
    tau += sg * dt;
  }
  let mu = max(dot(rd, sx), 0.);
  let ph = .3 + 2. * mu * mu * mu;
  return vec4f(min(acc * dt * rayk() * g.mis.y * ph * shaftc() * sunc(), vec3f(20.)), zl);
}
`;
// depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y) , vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  // depth-aware upsample of the half-res shafts
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .06) + bl * .03;
  c *= g.mis.x;
  let q = uv - .5;
  c *= 1. - dot(q, q) * .55;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .55);
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.55, 1., l) * .1);
  c = mix(vec3f(l), c, .93) + mix(vec3f(.008, .002, 0.), vec3f(.001, .003, .008), g.mis.w);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;

// ---------------------------------------------------------------- the rift: a tear in the air that leads to the volcano
// One camera-facing quad standing at RIFT, drawn the way the additive sprites are: depth-tested, not depth-writing,
// no vertex or instance buffer. A vertical seam of light, tapering to a point at both ends, with wavering veils of
// heat on either side of it. Everything moves as a closed form of g.cam.w, so the CPU does nothing per frame.
// No frame and no architecture: it is the orange of the lava on the other side, against the green of everything here.
// On the camera path (its third control point), 28 m ahead of viewpoint 1 (the start) in the middle of its view,
// where the light shaft of that viewpoint comes down: the generator keeps the path free of trunks and lianas.
// main.js stands it on the ground under it (RIFT[1]) and only then compiles this, which is why it is a function.
const RIFT = [-8, -44.4, -14];             // centre: x, y (set at load: the ground + RIFT_UP), z
const RIFT_UP = 3.6;                         // height of the centre above the ground
const RIFT_HW = 2.6, RIFT_HH = 5;            // half-width and half-height of the quad (m): the seam itself is far thinner
const rfN = (v) => '(' + v.toFixed(2) + ')'; // a WGSL float literal, in brackets: the minifier would join "a - -b"
const W_RIFT = () => S_B + /*wgsl*/`
const RF_P = vec3f(${rfN(RIFT[0])}, ${rfN(RIFT[1])}, ${rfN(RIFT[2])});
const RF_HW = ${rfN(RIFT_HW)};
const RF_HH = ${rfN(RIFT_HH)};
const RF_CORE = vec3f(12., 6.5, 2.2);      // the seam itself (HDR: the bloom chain picks it up)
const RF_HALO = vec3f(3., .65, .06);       // the glow and the shimmering veils around it
const RF_HAZE = .5;                          // share of the haze extinction it suffers (1 = like a lit surface)
struct RFO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> RFO {
  var o: RFO;
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  // g.right is horizontal, so the quad turns to the camera about the vertical and the seam stays upright
  let wp = RF_P + g.right.xyz * (q.x * RF_HW) + vec3f(0., q.y * RF_HH, 0.);
  o.uv = q;
  o.wp = wp;
  o.cp = g.vp * vec4f(wp, 1.);
  return o;
}
@fragment fn fs(i: RFO) -> @location(0) vec4f {
  let t = g.cam.w;
  let x = i.uv.x * RF_HW; let y = i.uv.y * RF_HH;
  // 1 at mid-height, 0 at the two tips
  let tp = max(1. - i.uv.y * i.uv.y, 0.);
  let env = tp * sqrt(tp);
  // the line of the tear wanders sideways, slowly and then in a fast small jitter
  let cx = .16 * sin(y * 1.3 + t * .7) + .09 * sin(y * 3.7 - t * 1.9) + .04 * sin(y * 9.1 + t * 4.3);
  let dx = abs(x - cx);
  // the seam: a few centimetres wide, breathing, with a ripple running down it
  let w = (.04 + .1 * env) * (.8 + .2 * sin(t * 1.7) + .12 * sin(y * 6. - t * 5.));
  let core = exp(0. - dx * dx / (w * w)) * ss(0., .12, tp);
  let halo = exp(0. - dx / (.5 * env + .03)) * env;
  // heat shimmer: two sets of slanting bands that climb at different speeds and bend each other, so the veils
  // never repeat and have gaps between them
  let s1 = sin(y * 2.9 - t * 3.5 + 2.2 * sin(x * 2.7 + t * 1.1) + x * 1.9);
  let s2 = sin(y * 6.7 - t * 6. + 1.6 * sin(y * 1.9 - x * 3.3 + t * .8) - x * 4.1);
  let sh = (.55 + .45 * s1) * (.55 + .45 * s2);
  let veil = exp(0. - dx / (1.1 * env + .03)) * env * sh;
  // nothing reaches the border of the quad, so it has no outline
  let edge = (1. - ss(.5, 1., abs(i.uv.x))) * (1. - ss(.8, 1., abs(i.uv.y)));
  let v = i.wp - g.cam.xyz; let d = max(length(v), 1e-3);
  let T = exp(0. - RF_HAZE * hzt(g.cam.xyz, v / d, d)) * ss(FARD, FARD * .7, d);
  let c = RF_CORE * core + RF_HALO * (halo * .6 + veil * .8);
  return vec4f(min(max(c * (edge * T * (.85 + .15 * sin(t * 2.3 + y * .8))), vec3f(0.)), vec3f(40.)), 0.);
}
`;
