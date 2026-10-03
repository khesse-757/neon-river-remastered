/**
 * GLSL for art direction v2. The painting is drawn crisp (nearest, whole multiples of its pitch)
 * and lit per painted texel; the water surface and everything on top of it are shaded per
 * device pixel. All passes output linear HDR; the final pass grades and encodes.
 * Painting coordinates are texels, y down.
 */

export const FULLSCREEN_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
uniform vec2 uCanvas; // render size in pixels
uniform float uScale; // pixels per painting texel
uniform vec2 uOrigin; // painting origin in texels
uniform vec2 uGrid;
uniform float uTime;
uniform sampler2D uBg;
uniform sampler2D uMaskA; // r water, g reeds, b canopy
uniform sampler2D uMaskB; // r far layer, g neon, b bridge
uniform sampler2D uField; // r bank distance, gb flow direction
uniform sampler2D uNoise;
uniform sampler2D uRipple;
uniform vec4 uCam; // focal, centerX, centerY (source pixels), height
uniform vec2 uPitch; // sin, cos
uniform float uSrcPerTexel;
uniform vec4 uLantern; // texel x, y, radius, intensity
uniform float uWind;
uniform float uNeon;
uniform float uDarken;
uniform float uDrift;
uniform float uFlash; // lightning / shock, 0..1

vec2 texelF() {
  return vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) / uScale - uOrigin;
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
bool inGrid(ivec2 q) {
  return q.x >= 0 && q.y >= 0 && q.x < int(uGrid.x) && q.y < int(uGrid.y);
}
ivec2 clampGrid(ivec2 q) {
  return clamp(q, ivec2(0), ivec2(uGrid) - 1);
}
vec3 bgAt(ivec2 q) { return texelFetch(uBg, clampGrid(q), 0).rgb; }
vec3 maskA(ivec2 q) { return inGrid(q) ? texelFetch(uMaskA, q, 0).rgb : vec3(0.0); }
vec3 maskB(ivec2 q) { return inGrid(q) ? texelFetch(uMaskB, q, 0).rgb : vec3(0.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float rippleAt(vec2 tf) { return texture2D(uRipple, tf / uGrid).r RIPPLE_DECODE; }
vec3 fieldAt(vec2 tf) { return texture2D(uField, tf / uGrid).rgb; }

// Point on the water plane seen through a painting texel: x right, y = view depth, z away.
vec3 waterPoint(vec2 tf) {
  vec2 src = tf * uSrcPerTexel;
  float t = (uCam.z - src.y) / uCam.x;
  float z = uCam.w * (uPitch.y + t * uPitch.x) / max(1e-4, uPitch.x - t * uPitch.y);
  float zc = uCam.w * uPitch.x + z * uPitch.y;
  return vec3((src.x - uCam.y) * zc / uCam.x, zc, z);
}

// Flow normal: two layers of noise sliding downstream in world space, plus live ripples.
vec2 flowNormal(vec2 tf, vec3 wp) {
  vec2 w = wp.xz;
  vec2 a = texture2D(uNoise, w * vec2(2.3, 1.1) + vec2(0.0, uTime * 0.11)).rg;
  vec2 b = texture2D(uNoise, w * vec2(5.1, 2.6) + vec2(uTime * 0.03, uTime * 0.19)).gr;
  vec2 n = (a + b - 1.0) * 1.3;
  float e = 0.75;
  n += vec2(rippleAt(tf + vec2(e, 0.0)) - rippleAt(tf - vec2(e, 0.0)), rippleAt(tf + vec2(0.0, e)) - rippleAt(tf - vec2(0.0, e))) * 3.2;
  return n;
}

float lightStep(float f) {
  return f > 0.62 ? 1.0 : (f > 0.34 ? 0.5 : (f > 0.0 ? 0.2 : 0.0));
}
vec3 dimmed(vec3 c) { return mix(c, vec3(0.0012, 0.0029, 0.0058), uDarken); }

// The painting with its masked motion.
vec3 paintingAt(ivec2 q) {
  int off = int(floor(sin(uTime * 1.6 + float(q.x) * 0.11 + float(q.y) * 0.25) * uWind + 0.5));
  if (off != 0) {
    ivec2 src = q - ivec2(off, 0);
    if (maskA(src).g > 0.5) return bgAt(src);
    if (maskA(q).g > 0.5) {
      ivec2 fill = q + ivec2(off, 0);
      if (maskA(fill).g < 0.5) return bgAt(fill);
    }
  }
  int lift = int(floor(sin(uTime * 0.55 + float(q.x) * 0.05 + float(q.y) * 0.08) * 0.72 + 0.5));
  if (lift != 0) {
    ivec2 src = q - ivec2(0, lift);
    if (maskA(src).b > 0.5 && maskA(q).b > 0.5) return bgAt(src);
  }
  return bgAt(q);
}

// Land, lit per painted texel so it stays pixel art.
vec3 landColor(ivec2 q) {
  vec3 mB = maskB(q);
  vec3 col;
  if (mB.r > 0.5) {
    // Far layer (sky and skyline) slides against the land for parallax, in whole texels.
    ivec2 far = q + ivec2(int(floor(uDrift + 0.5)), 0);
    if (maskB(far).r < 0.5) far = q;
    col = bgAt(far);
    if (maskB(far).g > 0.5) {
      vec2 cell = floor(vec2(far) / 5.0);
      float flick = hash(cell + floor(uTime * 7.0)) < 0.035 ? 0.55 : 1.0;
      float pulse = 0.93 + 0.07 * sin(uTime * 0.8 + cell.x * 1.7);
      // Neon runs hot so the bloom pass picks it up.
      col *= flick * pulse * uNeon * 2.1;
    } else if (luma(col) > 0.1 && luma(bgAt(far + ivec2(1, 1))) < 0.08) {
      if (hash(vec2(far) + floor(uTime * 1.6)) < 0.22) col = bgAt(far + ivec2(1, 1));
    }
    col += vec3(0.5, 0.6, 0.9) * uFlash * 0.5;
  } else {
    col = paintingAt(q);
  }
  // Lantern: a warm, stepped pool of light that keeps the lit surface's own texture.
  vec2 ld = (vec2(q) + 0.5 - uLantern.xy) / uLantern.z;
  float ls = lightStep(1.0 - length(ld)) * uLantern.w;
  col = col * mix(vec3(1.0), vec3(2.6, 1.7, 0.8), ls) + vec3(0.03, 0.014, 0.0) * ls;
  col += col * vec3(0.6, 0.8, 1.2) * uFlash;
  return col;
}
`;

/** The world: gutters, painting, and the river bed seen through moving water. */
export const WORLD_FRAG = /* glsl */ `
${COMMON}
void main() {
  vec2 tf = texelF();
  ivec2 q = ivec2(floor(tf));
  if (!inGrid(q)) {
    ivec2 t = ivec2(floor(tf + uOrigin));
    float horizon = uOrigin.y + uGrid.y * 0.1;
    vec3 col = vec3(0.0012, 0.0029, 0.0058);
    if (float(t.y) < horizon && hash(vec2(t)) > 0.9965 - 0.002 * (1.0 - float(t.y) / max(1.0, horizon))) {
      float tw = hash(vec2(t) + floor(uTime * 1.5));
      col = tw > 0.3 ? vec3(0.17, 0.33, 0.45) : vec3(0.03, 0.1, 0.2);
    }
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  vec3 col;
  if (maskA(q).r > 0.5) {
    // Refraction: the painted bed swims under the surface, smoothly, at device resolution.
    vec3 wp = waterPoint(tf);
    vec2 n = flowNormal(tf, wp);
    float texelsPerUnit = uCam.x / wp.y / uSrcPerTexel;
    vec2 at = tf + n * 0.0042 * texelsPerUnit;
    ivec2 q2 = ivec2(floor(at));
    if (maskA(q2).r < 0.5) q2 = q;
    col = bgAt(q2);
    // Depth absorption: the channel sinks toward a darker teal away from the banks.
    float deep = fieldAt(tf).r;
    col = mix(col, vec3(0.002, 0.03, 0.06), 0.34 * smoothstep(0.1, 0.9, deep));
    vec2 ld = (tf - uLantern.xy) / uLantern.z;
    col += vec3(0.5, 0.26, 0.07) * smoothstep(1.0, 0.0, length(ld)) * uLantern.w * 0.05;
    col += col * vec3(0.6, 0.8, 1.2) * uFlash;
  } else {
    col = landColor(q);
  }
  gl_FragColor = vec4(dimmed(col), 1.0);
}`;

/** Land redrawn over the river layer so fish and water never spill past the banks, reeds or bridge. */
export const OCCLUDER_FRAG = /* glsl */ `
${COMMON}
void main() {
  vec2 tf = texelF();
  ivec2 q = ivec2(floor(tf));
  if (!inGrid(q)) discard;
  vec3 mA = maskA(q);
  if (mA.r > 0.5) discard;
  if (mA.g > 0.5 || maskA(q - ivec2(1, 0)).g > 0.5 || maskA(q + ivec2(1, 0)).g > 0.5) {
    // Reed clumps: only the stalks occlude; water seen between them stays open.
    vec3 c = paintingAt(q);
    if (c.b > c.g * 1.05 && c.b > c.r * 1.2) discard;
  }
  gl_FragColor = vec4(dimmed(landColor(q)), 1.0);
}`;

/** The river's surface: Fresnel reflections of the skyline, moon glints, foam, ripples, lights. */
export const SURFACE_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uMoonDir;
uniform vec4 uLights[6]; // world x, z, radius, intensity
uniform vec3 uLightColors[6];
uniform float uReflect;

void main() {
  vec2 tf = texelF();
  ivec2 q = ivec2(floor(tf));
  if (!inGrid(q) || maskA(q).r < 0.5) discard;
  vec3 wp = waterPoint(tf);
  vec3 P = vec3(wp.x, 0.0, wp.z);
  vec2 n2 = flowNormal(tf, wp);
  vec3 N = normalize(vec3(n2.x * 0.16, 1.0, n2.y * 0.16));
  vec3 V = normalize(vec3(0.0, uCam.w, 0.0) - P);
  float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);

  // Reflection: follow the mirrored view ray out to the painted skyline.
  vec3 R = reflect(-V, N);
  float yc = R.y * uPitch.y + R.z * uPitch.x;
  float zc = -R.y * uPitch.x + R.z * uPitch.y;
  vec3 refl = vec3(0.004, 0.012, 0.03);
  if (zc > 0.02) {
    vec2 src = vec2(uCam.y + uCam.x * R.x / zc, uCam.z - uCam.x * yc / zc);
    ivec2 rq = ivec2(floor(src / uSrcPerTexel)) + ivec2(int(floor(uDrift + 0.5)), 0);
    if (inGrid(rq) && maskB(rq).r > 0.5) {
      refl = bgAt(rq);
      if (maskB(rq).g > 0.5) refl *= 2.4 * uNeon;
    }
  }
  refl *= uReflect;

  // Moon: stepped glints where the surface tilts the highlight toward the eye.
  vec3 H = normalize(uMoonDir + V);
  float sp = pow(clamp(dot(N, H), 0.0, 1.0), 220.0);
  float glint = sp > 0.5 ? 1.0 : (sp > 0.16 ? 0.4 : 0.0);
  vec3 col = refl * fres + vec3(0.62, 0.8, 0.95) * glint * 0.95;
  float alpha = clamp(fres * 0.92 + glint, 0.0, 1.0);

  // Bank foam: a soft broken line that breathes with the flow.
  vec3 field = fieldAt(tf);
  float edge = field.r * 14.0;
  float foam = smoothstep(1.7, 0.5, edge + (texture2D(uNoise, wp.xz * 9.0 + uTime * 0.05).r - 0.5) * 1.6);
  foam *= 0.55 + 0.45 * sin(uTime * 1.4 + wp.z * 9.0);
  col = mix(col, vec3(0.5, 0.68, 0.78), foam * 0.5);
  alpha = max(alpha, foam * 0.5);

  // Ripple crests and troughs from the height-field.
  float h = rippleAt(tf);
  float crest = smoothstep(0.07, 0.24, h);
  col = mix(col, vec3(0.55, 0.75, 0.86), crest * 0.7);
  alpha = max(alpha, crest * 0.7);
  float trough = smoothstep(0.14, 0.32, -h);
  col = mix(col, vec3(0.002, 0.014, 0.035), trough * 0.5);
  alpha = max(alpha, trough * 0.35);

  // Lights lying on the water: eels (cold), koi (warm).
  for (int i = 0; i < 6; i++) {
    vec4 l = uLights[i];
    if (l.w <= 0.0) continue;
    float d = length(P.xz - l.xy) / l.z;
    float a = smoothstep(1.0, 0.0, d);
    a = a * a * l.w;
    col += uLightColors[i] * a * (0.6 + 0.4 * clamp(0.5 + n2.x * 0.5, 0.0, 1.0));
    alpha = max(alpha, a * 0.45);
  }
  col += col * vec3(0.6, 0.8, 1.2) * uFlash;
  // Straight alpha here; the material blends premultiplied.
  gl_FragColor = vec4(dimmed(col) * alpha, alpha);
}`;

/** Wave-equation height field over the painting grid. */
export const RIPPLE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uMask;
uniform vec2 uSize;
uniform vec4 uImpulses[8]; // x, y, radius, strength
float dec(float v) { return v RIPPLE_DECODE; }
float enc(float v) { return v RIPPLE_ENCODE; }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(uSize) - 1;
  vec4 c = texelFetch(uPrev, q, 0);
  float h = dec(c.r);
  float prev = dec(c.g);
  float l = dec(texelFetch(uPrev, clamp(q - ivec2(1, 0), ivec2(0), hi), 0).r);
  float r = dec(texelFetch(uPrev, clamp(q + ivec2(1, 0), ivec2(0), hi), 0).r);
  float u = dec(texelFetch(uPrev, clamp(q - ivec2(0, 1), ivec2(0), hi), 0).r);
  float d = dec(texelFetch(uPrev, clamp(q + ivec2(0, 1), ivec2(0), hi), 0).r);
  float lap = (l + r - 2.0 * h) * 0.30 + (u + d - 2.0 * h) * 0.11;
  float next = (2.0 * h - prev + lap) * 0.972;
  for (int i = 0; i < 8; i++) {
    vec4 imp = uImpulses[i];
    if (imp.w == 0.0) continue;
    vec2 dd = (vec2(q) - imp.xy) / vec2(imp.z, imp.z * 0.6);
    next += imp.w * max(0.0, 1.0 - dot(dd, dd));
  }
  if (texelFetch(uMask, q, 0).r < 0.5) next = 0.0;
  next = clamp(next, -1.0, 1.0);
  gl_FragColor = vec4(enc(next), enc(h), 0.0, 1.0);
}`;

/** Textured quad placed in target texels (UI and the fisherman). */
export const QUAD_VERT = /* glsl */ `
precision highp float;
uniform vec2 uTarget;
uniform vec4 uRect; // x, y, w, h in target texels
varying vec2 vLocal;
void main() {
  vLocal = position.xy * uRect.zw;
  vec2 p = uRect.xy + vLocal;
  gl_Position = vec4(p.x / uTarget.x * 2.0 - 1.0, 1.0 - p.y / uTarget.y * 2.0, 0.0, 1.0);
}`;

/** UI quads are drawn after post, in display-space colors, so they stay crisp pixel art. */
export const QUAD_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uTintMix;
varying vec2 vLocal;
void main() {
#ifdef FLAT
  vec4 c = vec4(1.0);
#else
  vec4 c = texelFetch(uMap, ivec2(floor(vLocal)), 0);
#endif
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(mix(c.rgb, uTint, uTintMix), 1.0);
}`;

/** The painted fisherman, relit: normals come from his own pixels. */
export const FISHERMAN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec4 uRect;
uniform float uBreath;
uniform float uLean;
uniform float uJolt;
uniform vec3 uLightDir; // toward the lantern in sprite space (x right, y down, z toward viewer)
uniform float uLight;
uniform float uFlash;
uniform float uDarken;
varying vec2 vLocal;
vec4 at(vec2 l) {
  if (l.x < 0.0 || l.y < 0.0 || l.x >= uRect.z || l.y >= uRect.w) return vec4(0.0);
  return texelFetch(uMap, ivec2(l), 0);
}
vec4 pose(vec2 l) {
  float ry = l.y / uRect.w;
  vec2 s = l;
  s.x -= uJolt;
  if (ry < 0.36) s.x -= uLean;
  if (ry < 0.62) s.y += uBreath;
  return at(s);
}
float height(vec2 l) {
  vec4 c = pose(l);
  return c.a < 0.5 ? 0.0 : 0.35 + dot(c.rgb, vec3(0.3, 0.6, 0.1)) * 2.0;
}
void main() {
  vec2 l = floor(vLocal);
  vec4 c = pose(l);
  if (c.a < 0.5) discard;
  // Normal map on the fly: the sprite's silhouette and shading read as a height field.
  vec3 n = normalize(vec3(height(l - vec2(1.0, 0.0)) - height(l + vec2(1.0, 0.0)), height(l - vec2(0.0, 1.0)) - height(l + vec2(0.0, 1.0)), 0.55));
  float lit = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
  float stepLit = lit > 0.6 ? 1.0 : (lit > 0.3 ? 0.45 : 0.0);
  vec3 col = c.rgb * (1.0 + vec3(2.4, 1.5, 0.6) * stepLit * uLight) + vec3(0.05, 0.025, 0.0) * stepLit * uLight;
  // Stay under the bloom threshold: lantern light warms him, it does not make him glow.
  col = min(col, vec3(0.8, 0.62, 0.42));
  col += (c.rgb + 0.03) * vec3(1.2, 2.2, 3.0) * uFlash * (0.4 + clamp(-n.x, 0.0, 1.0));
  gl_FragColor = vec4(mix(col, vec3(0.0012, 0.0029, 0.0058), uDarken), 1.0);
}`;

/** Soft round particles in target texels; HDR colors feed the bloom. */
export const PARTICLE_VERT = /* glsl */ `
precision highp float;
uniform vec2 uTarget;
attribute vec3 iPoint; // x, y (target texels), size (texels)
attribute vec4 iColor; // rgb, alpha
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec2 p = iPoint.xy + (position.xy - 0.5) * iPoint.z;
  vColor = iColor;
  vUv = position.xy * 2.0 - 1.0;
  gl_Position = vec4(p.x / uTarget.x * 2.0 - 1.0, 1.0 - p.y / uTarget.y * 2.0, 0.0, 1.0);
}`;

export const PARTICLE_FRAG = /* glsl */ `
precision highp float;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float d = dot(vUv, vUv);
  if (d > 1.0) discard;
  float a = (1.0 - d) * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

export const FINAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Final pass: vignette, palette grade with a strength (not a hard quantize), sRGB encode. */
export const FINAL_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler2D tDiffuse;
uniform sampler3D uLut;
uniform float uGrade;
uniform float uVignette;
uniform float uGlitch;
uniform vec2 uSource;
varying vec2 vUv;
// Sharp-bilinear: nearest inside each source pixel, a one-screen-pixel blend at its edges.
vec2 sharp(vec2 uv) {
  vec2 px = uv * uSource;
  vec2 seam = floor(px + 0.5);
  vec2 w = max(fwidth(px), vec2(1e-5));
  return (seam + clamp((px - seam) / w, -0.5, 0.5)) / uSource;
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = sharp(vUv);
  vec3 col = texture2D(tDiffuse, uv).rgb;
  if (uGlitch > 0.0) {
    col.r = texture2D(tDiffuse, uv + vec2(uGlitch, 0.0)).r;
    col.b = texture2D(tDiffuse, uv - vec2(uGlitch, 0.0)).b;
  }
  vec2 d = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
  // Soft shoulder so bloomed highlights roll off instead of clipping.
  col = col / (1.0 + max(vec3(0.0), col - 0.8) * 0.6);
  vec3 s = toSrgb(col);
  vec3 graded = texture(uLut, s * (31.0 / 32.0) + 0.5 / 32.0).rgb;
  gl_FragColor = vec4(mix(s, graded, uGrade), 1.0);
}`;
