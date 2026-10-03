/**
 * GLSL for the pixel pipeline. Everything works in whole target texels (texelFetch, no filtering)
 * so nothing ever leaves the shared pixel grid. Texel coordinates are y-down.
 */

/** Fullscreen triangle-pair vertex shader for layer passes. */
export const FULLSCREEN_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
uniform vec2 uTarget;
uniform vec2 uOrigin;
uniform vec2 uGrid;
uniform float uTime;
uniform sampler2D uBg;
uniform sampler2D uMaskA; // r water, g reeds, b canopy
uniform sampler2D uMaskB; // r sky, g neon, b bridge
uniform sampler2D uRipple;
uniform vec4 uLights[8]; // x, y (target texels), radius, intensity
uniform vec3 uLightColors[8];
uniform vec4 uLantern;
uniform float uWind;
uniform float uNeon;
uniform float uDarken;

ivec2 targetTexel() {
  return ivec2(int(gl_FragCoord.x), int(uTarget.y) - 1 - int(gl_FragCoord.y));
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
float rippleAt(ivec2 q) { return texelFetch(uRipple, clampGrid(q), 0).r RIPPLE_DECODE; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// The painting with its masked motion: reeds sway, canopies breathe. Whole-texel moves only.
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

float lightStep(float f) {
  return f > 0.62 ? 1.0 : (f > 0.34 ? 0.5 : (f > 0.0 ? 0.2 : 0.0));
}
vec3 applyLights(vec3 col, ivec2 t, bool water) {
  if (water) {
    for (int i = 0; i < 8; i++) {
      vec4 l = uLights[i];
      if (l.w <= 0.0) continue;
      vec2 d = (vec2(t) - l.xy) / vec2(l.z, l.z * 0.55);
      col += uLightColors[i] * lightStep(1.0 - length(d)) * l.w;
    }
  }
  // Lantern: a warm ramp that keeps the lit surface's own texture; only a hint reaches the water.
  vec2 ld = (vec2(t) - uLantern.xy) / uLantern.z;
  float ls = lightStep(1.0 - length(ld)) * uLantern.w * (water ? 0.3 : 1.0);
  col = col * mix(vec3(1.0), vec3(2.2, 1.6, 0.9), ls) + vec3(0.1, 0.05, 0.0) * ls;
  return col;
}
`;

/** Painting, living water (under-surface part), neon, stars, gutters. */
export const BACKGROUND_FRAG = /* glsl */ `
${COMMON}
uniform float uReflect;

void main() {
  ivec2 t = targetTexel();
  ivec2 q = t - ivec2(uOrigin);
  if (!inGrid(q)) {
    // Gutters: a calm extension of the night. Sparse stars above the painting's horizon.
    float horizon = uOrigin.y + uGrid.y * 0.1;
    vec3 col = vec3(0.012, 0.035, 0.067);
    if (float(t.y) < horizon && hash(vec2(t)) > 0.9965 - 0.002 * (1.0 - float(t.y) / max(1.0, horizon))) {
      float tw = hash(vec2(t) + floor(uTime * 1.5));
      col = tw > 0.3 ? vec3(0.447, 0.624, 0.706) : vec3(0.161, 0.349, 0.498);
    }
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  vec3 mA = maskA(q);
  vec3 mB = maskB(q);
  vec3 col;
  bool water = mA.r > 0.5;
  if (water) {
    // Refraction: painted highlights slide sideways with the flow and with ripples.
    float depth = clamp((float(q.y) / uGrid.y - 0.17) / 0.58, 0.0, 1.0);
    float w = sin(float(q.y) * 0.9 - uTime * 2.1 + sin(float(q.x) * 0.21 + uTime * 0.7) * 1.5);
    int xo = w > 0.86 - depth * 0.1 ? 1 : (w < -0.86 + depth * 0.1 ? -1 : 0);
    float hx = rippleAt(q + ivec2(1, 0)) - rippleAt(q - ivec2(1, 0));
    xo += int(clamp(floor(hx * 5.0 + 0.5), -2.0, 2.0));
    ivec2 q2 = q + ivec2(xo, 0);
    if (maskA(q2).r < 0.5) q2 = q;
    col = bgAt(q2);

    // Broken streaks of the skyline's neon, mirrored into the middle reach.
    float ry = float(q.y) / uGrid.y;
    if (ry > 0.24 && ry < 0.52) {
      int srcY = int(uGrid.y * 0.125 - (ry - 0.24) * uGrid.y * 0.42);
      ivec2 src = ivec2(q.x + xo + int(floor(sin(float(q.y) * 1.7 + uTime * 1.3) + 0.5)), srcY);
      bool dash = mod(float(q.y) + floor(uTime * 2.5), 3.0) < 1.0;
      if (dash && srcY >= 0 && maskB(src).g > 0.5) col = mix(col, bgAt(src), 0.3 * uReflect);
    }
  } else {
    col = paintingAt(q);
  }

  if (mB.g > 0.5) {
    vec2 cell = floor(vec2(q) / 5.0);
    float flick = hash(cell + floor(uTime * 7.0)) < 0.035 ? 0.55 : 1.0;
    float pulse = 0.93 + 0.07 * sin(uTime * 0.8 + cell.x * 1.7);
    col *= flick * pulse * uNeon;
  } else if (mB.r > 0.5 && luma(col) > 0.34 && luma(bgAt(q + ivec2(1, 1))) < 0.3) {
    if (hash(vec2(q) + floor(uTime * 1.6)) < 0.22) col = bgAt(q + ivec2(1, 1));
  }

  col = applyLights(col, t, water) * (1.0 - uDarken);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Drawn over the fish: surface glints and ripple crests, plus reeds and bridge as occluders. */
export const OVERLAY_FRAG = /* glsl */ `
${COMMON}
uniform float uGlint;

void main() {
  ivec2 t = targetTexel();
  ivec2 q = t - ivec2(uOrigin);
  if (!inGrid(q)) discard;
  vec3 mA = maskA(q);
  bool reed = mA.g > 0.5 || maskA(q - ivec2(1, 0)).g > 0.5 || maskA(q + ivec2(1, 0)).g > 0.5;
  if (mA.r < 0.5 && reed) {
    vec3 c = paintingAt(q);
    // Only stalks occlude; water seen between them stays transparent so fish show through.
    if (c.b > c.g + 0.02 && c.b > c.r + 0.04) discard;
    gl_FragColor = vec4(applyLights(c, t, false) * (1.0 - uDarken), 1.0);
    return;
  }
  if (maskB(q).b > 0.5) {
    gl_FragColor = vec4(applyLights(bgAt(q), t, false) * (1.0 - uDarken), 1.0);
    return;
  }
  if (mA.r < 0.5) discard;

  // Flow-aligned glint dashes that drift downstream, longer and faster near the net.
  float k = clamp((float(q.y) / uGrid.y - 0.17) / 0.58, 0.0, 1.0);
  float len = floor(2.0 + 4.0 * k);
  float row = floor(float(q.y) - uTime * (1.5 + 6.0 * k));
  float x = float(q.x) + hash(vec2(row, 3.0)) * 40.0;
  float cell = floor(x / (len * 3.0));
  bool inDash = mod(x, len * 3.0) < len;
  float moonlit = luma(bgAt(q)) > 0.42 ? 0.08 : 0.0;
  float pick = hash(vec2(row, cell));
  bool alive = hash(vec2(row + cell, floor(uTime * 1.3 + pick * 6.0))) > 0.45;
  float h = rippleAt(q);
  vec3 col = vec3(0.0);
  bool lit = false;
  if (inDash && alive && pick > 0.955 - moonlit - uGlint) {
    col = pick > 0.985 ? vec3(0.612, 0.796, 0.812) : vec3(0.231, 0.427, 0.573);
    lit = true;
  }
  if (h > 0.16) {
    col = h > 0.42 ? vec3(0.78, 0.882, 0.91) : vec3(0.447, 0.624, 0.706);
    lit = true;
  } else if (h < -0.22) {
    col = vec3(0.016, 0.122, 0.255);
    lit = true;
  }
  if (!lit) discard;
  gl_FragColor = vec4(applyLights(col, t, true) * (1.0 - uDarken), 1.0);
}`;

/** Wave-equation height field in painting space; rings are squashed to read as lying on the water. */
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

/** Instanced pixel sprites with whole-texel row waves (swim cycle) and shear (heading). */
export const SPRITE_VERT = /* glsl */ `
precision highp float;
uniform vec2 uTarget;
attribute vec2 iPos; // top-left of the sprite, target texels
attribute vec4 iRect; // atlas x, y, w, h
attribute vec4 iAnim; // phase, amplitude, shear, body-wave weight
attribute vec4 iLook; // underwater tint, flash, opacity, unused
varying vec2 vLocal;
varying vec4 vRect;
varying vec4 vAnim;
varying vec4 vLook;
varying float vPad;
void main() {
  float pad = ceil(iRect.w * 0.45) + 2.0;
  vec2 size = vec2(iRect.z + pad * 2.0, iRect.w);
  vec2 p = iPos - vec2(pad, 0.0) + position.xy * size;
  vLocal = position.xy * size;
  vRect = iRect;
  vAnim = iAnim;
  vLook = iLook;
  vPad = pad;
  gl_Position = vec4(p.x / uTarget.x * 2.0 - 1.0, 1.0 - p.y / uTarget.y * 2.0, 0.0, 1.0);
}`;

export const SPRITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform vec3 uDeep;
uniform float uDarken;
varying vec2 vLocal;
varying vec4 vRect;
varying vec4 vAnim;
varying vec4 vLook;
varying float vPad;
void main() {
  vec2 l = floor(vLocal);
  float row = l.y;
  float h = vRect.w;
  // The tail (top rows) swings most; eels wave along the whole body.
  float tail = mix(1.0 - row / max(1.0, h - 1.0), 1.0, vAnim.w);
  float wave = floor(sin(vAnim.x + row * 0.8) * vAnim.y * tail + 0.5);
  float shear = floor(vAnim.z * (row - h * 0.5) + 0.5);
  float sx = l.x - vPad - wave - shear;
  if (sx < 0.0 || sx >= vRect.z || row < 0.0 || row >= h) discard;
  vec4 c = texelFetch(uAtlas, ivec2(int(vRect.x + sx), int(vRect.y + row)), 0);
  if (c.a < 0.1) discard;
  // Checker dissolve keeps fading on the grid.
  if (vLook.z < 1.0 && mod(l.x + l.y, 2.0) >= vLook.z * 2.0) discard;
  vec3 col = c.a < 0.75 ? mix(uDeep * 0.55, c.rgb, 1.0 - min(1.0, vLook.x * 2.4)) : mix(c.rgb, uDeep, vLook.x);
  col = mix(col, vec3(1.0), vLook.y);
  gl_FragColor = vec4(col * (1.0 - uDarken), 1.0);
}`;

/** Plain textured quad placed in target texels (fisherman, lantern, text, panels). */
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

export const QUAD_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec4 uRect;
uniform vec3 uTint;
uniform float uTintMix;
uniform float uDarken;
varying vec2 vLocal;
void main() {
#ifdef FLAT
  vec4 c = vec4(1.0);
#else
  vec4 c = texelFetch(uMap, ivec2(floor(vLocal)), 0);
#endif
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(mix(c.rgb, uTint, uTintMix) * (1.0 - uDarken), 1.0);
}`;

/** The fisherman: his sprite, deformed in whole texels. */
export const FISHERMAN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec4 uRect;
uniform float uBreath; // 0 or 1
uniform float uLean; // -1, 0, 1 hat tilt
uniform float uJolt; // -1, 0, 1
uniform float uRim;
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
void main() {
  vec2 l = floor(vLocal);
  vec4 c = pose(l);
  if (c.a < 0.5) discard;
  vec3 col = c.rgb;
  // Warm rim on the lantern side (his left).
  if (pose(l - vec2(1.0, 0.0)).a < 0.5 && l.y / uRect.w > 0.3) col = mix(col, vec3(1.0, 0.7, 0.28), uRim);
  gl_FragColor = vec4(col * (1.0 - uDarken), 1.0);
}`;

/** Net pole, hoop and mesh, drawn analytically at texel centres. */
export const NET_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uTarget;
uniform vec2 uGrip;
uniform vec2 uHoop;
uniform vec2 uRadii;
uniform float uKick;
uniform float uDarken;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uTarget.y - gl_FragCoord.y);
  vec2 c = uHoop + vec2(0.0, uKick);
  vec2 e = (p - c) / uRadii;
  float r = length(e);
  float rim = abs(r - 1.0) * min(uRadii.x, uRadii.y);
  vec3 col;
  if (rim < 0.75) {
    col = e.y > 0.1 ? vec3(0.612, 0.796, 0.812) : vec3(0.329, 0.494, 0.635);
  } else if (r < 1.0) {
    vec2 f = floor(p + vec2(0.0, uKick));
    bool strand = mod(f.x + f.y, 4.0) < 1.0 || mod(f.x - f.y, 4.0) < 1.0;
    if (!strand) discard;
    col = vec3(0.129, 0.388, 0.294);
  } else {
    // Pole from the grip to the near side of the hoop.
    vec2 a = uGrip;
    vec2 dir = normalize(a - c);
    vec2 b = c + dir * uRadii * 0.98;
    vec2 ab = b - a;
    float tt = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    vec2 n = p - (a + ab * tt);
    float d = length(n);
    if (d > 1.3) discard;
    col = n.y < 0.0 ? vec3(0.631, 0.596, 0.478) : vec3(0.514, 0.267, 0.2);
  }
  gl_FragColor = vec4(col * (1.0 - uDarken), 1.0);
}`;

/** One-texel particles. */
export const PARTICLE_VERT = /* glsl */ `
precision highp float;
uniform vec2 uTarget;
attribute vec3 iPoint; // x, y, size
attribute vec3 iColor;
varying vec3 vColor;
void main() {
  vec2 p = floor(iPoint.xy) + position.xy * iPoint.z;
  vColor = iColor;
  gl_Position = vec4(p.x / uTarget.x * 2.0 - 1.0, 1.0 - p.y / uTarget.y * 2.0, 0.0, 1.0);
}`;

export const PARTICLE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}`;

/** Voxel-extruded fish (look-dev A/B): instanced cubes with a three-step palette ramp. */
export const VOXEL_VERT = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormal;
void main() {
  vColor = instanceColor;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

export const VOXEL_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uDeep;
uniform float uTint;
uniform float uDarken;
varying vec3 vColor;
varying vec3 vNormal;
void main() {
  float ramp = vNormal.y > 0.5 ? 1.0 : (vNormal.z > 0.3 ? 0.72 : 0.5);
  gl_FragColor = vec4(mix(vColor * ramp, uDeep, uTint) * (1.0 - uDarken), 1.0);
}`;

/** Palette lock: nearest two palette colors + 4x4 Bayer, at target resolution. */
export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler2D uScene;
uniform sampler3D uLut;
uniform sampler2D uPalette;
uniform vec2 uTarget;
uniform vec2 uOrigin;
uniform vec2 uGrid;
uniform float uDither;
uniform float uGlitch;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(uTarget) - 1;
  vec3 col = texelFetch(uScene, p, 0).rgb;
  if (uGlitch > 0.0) {
    // Two-frame chromatic split on the eel shock only.
    int o = int(uGlitch);
    col.r = texelFetch(uScene, clamp(p + ivec2(o, 0), ivec2(0), hi), 0).r;
    col.b = texelFetch(uScene, clamp(p - ivec2(o, 0), ivec2(0), hi), 0).b;
  }
  col = clamp(col, 0.0, 1.0);
  vec4 e = texelFetch(uLut, ivec3(col * 63.0 + 0.5), 0);
  vec3 a = texelFetch(uPalette, ivec2(int(e.r * 255.0 + 0.5), 0), 0).rgb;
  vec3 b = texelFetch(uPalette, ivec2(int(e.g * 255.0 + 0.5), 0), 0).rgb;
  vec3 ab = b - a;
  float t = dot(ab, ab) > 0.0 ? clamp(dot(col - a, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
  float threshold = (BAYER[(p.x & 3) + ((int(uTarget.y) - 1 - p.y) & 3) * 4] + 0.5) / 16.0;
  gl_FragColor = vec4(t * uDither > threshold ? b : a, 1.0);
}`;

/** Nearest integer upscale to the canvas. */
export const BLIT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uFrame;
uniform vec2 uTarget;
uniform vec2 uCanvas;
uniform float uScale;
void main() {
  float yDown = uCanvas.y - gl_FragCoord.y;
  ivec2 t = ivec2(int(gl_FragCoord.x / uScale), int(yDown / uScale));
  t = clamp(t, ivec2(0), ivec2(uTarget) - 1);
  gl_FragColor = vec4(texelFetch(uFrame, ivec2(t.x, int(uTarget.y) - 1 - t.y), 0).rgb, 1.0);
}`;
