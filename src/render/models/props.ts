import * as THREE from 'three';
import { color, pixelArt } from '../assets';

/** Hero props, built in code: the net, the paper lantern, the catch basket. World units. */

const toon = (ramp: THREE.Texture, params: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial =>
  new THREE.MeshToonMaterial({ gradientMap: ramp, ...params });

export class NetProp {
  readonly root = new THREE.Group();
  readonly pole: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly hinge = new THREE.Group();
  private readonly clothUniforms = { uSway: { value: new THREE.Vector2() }, uBulge: { value: 0 } };
  private readonly ring: THREE.MeshToonMaterial;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private sway = new THREE.Vector2();

  constructor(
    ramp: THREE.Texture,
    readonly radius: number,
    layer: number,
  ) {
    const R = radius;
    const depth = R * 0.95;

    // Hoop: steel with a darker inner band.
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.055, 8, 40), toon(ramp, { color: color('#9fb4bd') }));
    hoop.rotation.x = Math.PI / 2;
    this.head.add(hoop);

    // Cloth net: a sagging bowl with a knotted-mesh pixel texture, cut out between the strands.
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      profile.push(new THREE.Vector2(R * Math.cos((t * Math.PI) / 2) ** 0.75 * 0.98, -depth * Math.sin((t * Math.PI) / 2)));
    }
    const mesh = pixelArt(
      16,
      16,
      (ctx) => {
        ctx.clearRect(0, 0, 16, 16);
        ctx.fillStyle = '#c9d6c2';
        for (let i = 0; i < 16; i++) {
          ctx.fillRect(i, i % 8, 1, 1);
          ctx.fillRect(i, 7 - (i % 8), 1, 1);
          ctx.fillRect(i, 8 + (i % 8), 1, 1);
          ctx.fillRect(i, 15 - (i % 8), 1, 1);
        }
        ctx.fillStyle = '#8fa39a';
        for (const [x, y] of [
          [0, 0],
          [8, 0],
          [4, 4],
          [12, 4],
          [0, 8],
          [8, 8],
          [4, 12],
          [12, 12],
        ] as const)
          ctx.fillRect(x, y, 2, 1);
      },
      true,
    );
    mesh.repeat.set(9, 3);
    const clothMaterial = toon(ramp, { map: mesh, alphaTest: 0.5, side: THREE.DoubleSide, color: color('#dfe8dc') });
    clothMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.clothUniforms);
      shader.uniforms.uDepth = { value: depth };
      shader.vertexShader =
        'uniform vec2 uSway;\nuniform float uBulge;\nuniform float uDepth;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float deep = clamp(-position.y / uDepth, 0.0, 1.0);
           // The belly trails behind the hoop, and swells and drops with a catch.
           transformed.xz += uSway * deep * deep;
           transformed.xz *= 1.0 + uBulge * 0.35 * deep * (1.0 - deep) * 4.0;
           transformed.y -= uBulge * uDepth * 0.35 * deep;`,
        );
    };
    clothMaterial.customProgramCacheKey = () => 'net-cloth';
    const cloth = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), clothMaterial);
    this.head.add(cloth);

    // Cyber hinge where the pole meets the hoop: brushed metal block, glowing teal ring.
    const block = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.16, R * 0.2, R * 0.34, 10), toon(ramp, { color: color('#6f7f8c') }));
    block.rotation.z = Math.PI / 2;
    this.ring = toon(ramp, { color: color('#0b2a30'), emissive: color('#29e0d0'), emissiveIntensity: 2.2 });
    const glow = new THREE.Mesh(new THREE.TorusGeometry(R * 0.2, R * 0.045, 6, 20), this.ring);
    glow.rotation.y = Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.09, R * 0.09, R * 0.42, 8), toon(ramp, { color: color('#2a3440') }));
    cap.rotation.z = Math.PI / 2;
    this.hinge.add(block, glow, cap);
    this.head.add(this.hinge);
    this.root.add(this.head);

    // Lacquered bamboo pole with node rings and gold-thread bindings (pixel texture along its length).
    const bamboo = pixelArt(4, 64, (ctx) => {
      ctx.fillStyle = '#6a2f22';
      ctx.fillRect(0, 0, 4, 64);
      ctx.fillStyle = '#8c4630';
      ctx.fillRect(1, 0, 1, 64);
      for (let y = 6; y < 64; y += 13) {
        ctx.fillStyle = '#3a1812';
        ctx.fillRect(0, y, 4, 1);
        ctx.fillStyle = '#a65a3a';
        ctx.fillRect(0, y + 1, 4, 1);
      }
      ctx.fillStyle = '#d9a441';
      ctx.fillRect(0, 0, 4, 3);
      ctx.fillRect(0, 58, 4, 4);
      ctx.fillStyle = '#7a5a1e';
      ctx.fillRect(0, 1, 4, 1);
      ctx.fillRect(0, 60, 4, 1);
    });
    this.pole = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.075, R * 0.095, 1, 8), toon(ramp, { map: bamboo }));
    this.root.add(this.pole);
    this.root.traverse((o) => o.layers.set(layer));
  }

  /**
   * Place the hoop and run the pole back to the fisherman's hands.
   * `lift` 0..1 raises and tilts the hoop for the scoop; `bulge` swells the cloth.
   */
  update(hoop: THREE.Vector3, grip: THREE.Vector3, velocity: number, lift: number, bulge: number, dt: number, charge: number): void {
    this.head.position.copy(hoop);
    this.head.position.y += lift * this.radius * 1.5;
    this.dir.subVectors(grip, this.head.position);
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    this.head.rotation.set(-lift * 0.5 * Math.cos(yaw), 0, lift * 0.5 * Math.sin(yaw));
    // Hinge sits on the rim facing the hands.
    this.hinge.position.set(Math.sin(yaw) * this.radius, 0, Math.cos(yaw) * this.radius);
    this.hinge.rotation.y = yaw + Math.PI / 2;

    // Cloth lags the hoop's motion and settles (dt-based spring).
    const target = new THREE.Vector2(-velocity * this.radius * 0.5, 0);
    this.sway.lerp(target, 1 - Math.exp(-9 * dt));
    this.clothUniforms.uSway.value.copy(this.sway);
    this.clothUniforms.uBulge.value = bulge;
    this.ring.emissiveIntensity = 1.6 + charge * 2.4;

    this.tip.copy(this.hinge.position).applyEuler(this.head.rotation).add(this.head.position);
    this.dir.subVectors(grip, this.tip);
    const length = this.dir.length();
    this.pole.position.copy(this.tip).addScaledVector(this.dir, 0.5);
    this.pole.scale.set(1, length, 1);
    this.pole.quaternion.setFromUnitVectors(this.up, this.dir.normalize());
  }
}

export class LanternProp {
  readonly root = new THREE.Group();
  /** World position of the flame, for the light. */
  readonly flame = new THREE.Vector3();
  private readonly hanger = new THREE.Group();
  private readonly paper: THREE.MeshToonMaterial;

  constructor(
    ramp: THREE.Texture,
    private readonly size: number,
    layer: number,
  ) {
    const wood = toon(ramp, { color: color('#3a2418') });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.07, size * 0.09, size * 3.2, 6), wood);
    post.position.y = size * 1.6;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.05, size * 0.05, size * 1.2, 6), wood);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(-size * 0.55, size * 3.1, 0);
    this.root.add(post, arm);

    this.hanger.position.set(-size * 1.1, size * 3.1, 0);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.02, size * 0.02, size * 0.5, 4), wood);
    cord.position.y = -size * 0.25;
    // Paper body: a ribbed ellipsoid with a banded pixel texture, lit from inside.
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      profile.push(new THREE.Vector2(Math.sin(a) * size * 0.62 + size * 0.05, -Math.cos(a) * size * 0.72));
    }
    const paperTexture = pixelArt(8, 16, (ctx) => {
      ctx.fillStyle = '#ffd98a';
      ctx.fillRect(0, 0, 8, 16);
      ctx.fillStyle = '#ffb347';
      for (let y = 1; y < 16; y += 3) ctx.fillRect(0, y, 8, 1);
      ctx.fillStyle = '#e8862a';
      ctx.fillRect(0, 0, 8, 1);
      ctx.fillRect(0, 15, 8, 1);
    });
    this.paper = toon(ramp, { map: paperTexture, emissive: color('#ffb347'), emissiveMap: paperTexture, emissiveIntensity: 1.5 });
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), this.paper);
    body.position.y = -size * 1.25;
    const dark = toon(ramp, { color: color('#1a1210') });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.3, size * 0.36, size * 0.16, 10), dark);
    top.position.y = -size * 0.52;
    const bottom = top.clone();
    bottom.position.y = -size * 1.98;
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(size * 0.1, size * 0.5, 5), toon(ramp, { color: color('#c0392b') }));
    tassel.position.y = -size * 2.3;
    tassel.rotation.x = Math.PI;
    this.hanger.add(cord, body, top, bottom, tassel);
    this.root.add(this.hanger);
    this.root.traverse((o) => o.layers.set(layer));
  }

  update(time: number, flicker: number, dim = 0): void {
    this.hanger.rotation.z = Math.sin(time * 1.3) * 0.11;
    this.hanger.rotation.x = Math.sin(time * 0.9 + 1.2) * 0.06;
    this.paper.emissiveIntensity = (1.15 + flicker * 0.5) * (1 - dim * 0.8);
    this.root.updateMatrixWorld(true);
    this.flame.set(0, -1.25 * this.size, 0).applyMatrix4(this.hanger.matrixWorld);
  }
}

export class BasketProp {
  readonly root = new THREE.Group();
  /** World position fish are tossed to. */
  readonly mouth = new THREE.Vector3();
  private readonly heap: THREE.InstancedMesh;
  private readonly heapMaterial: THREE.MeshToonMaterial;
  private readonly water: THREE.Mesh;
  private readonly tints: THREE.Color[] = [];
  private readonly rest: THREE.Matrix4[] = [];
  private readonly char = color('#17110c');
  private readonly gold = color('#ffcf5a');
  private shown = 0;
  private fried = -1;

  constructor(
    ramp: THREE.Texture,
    private readonly size: number,
    layer: number,
  ) {
    const weave = pixelArt(
      8,
      8,
      (ctx) => {
        ctx.fillStyle = '#9a7340';
        ctx.fillRect(0, 0, 8, 8);
        ctx.fillStyle = '#6e4f2a';
        ctx.fillRect(0, 0, 4, 2);
        ctx.fillRect(4, 4, 4, 2);
        ctx.fillStyle = '#c29a5c';
        ctx.fillRect(0, 2, 4, 2);
        ctx.fillRect(4, 6, 4, 2);
        ctx.fillStyle = '#4c3519';
        ctx.fillRect(3, 0, 1, 4);
        ctx.fillRect(7, 4, 1, 4);
      },
      true,
    );
    weave.repeat.set(7, 3);
    const profile = [
      new THREE.Vector2(size * 0.7, 0),
      new THREE.Vector2(size * 0.92, size * 0.4),
      new THREE.Vector2(size, size * 0.95),
      new THREE.Vector2(size * 0.94, size * 1.05),
    ];
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), toon(ramp, { map: weave, side: THREE.DoubleSide }));
    const base = new THREE.Mesh(new THREE.CircleGeometry(size * 0.7, 16), toon(ramp, { color: color('#2a1d0e') }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = size * 0.02;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(size * 0.97, size * 0.07, 6, 20), toon(ramp, { color: color('#5a3f20') }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = size * 1.02;
    // A soft contact shadow on the cobbles, and a little water in the bottom.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(size * 1.35, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(size * 0.12, size * 0.01, size * 0.1);
    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.78, 16),
      new THREE.MeshToonMaterial({
        gradientMap: ramp,
        color: color('#2f6f86'),
        transparent: true,
        opacity: 0.55,
        emissive: color('#16384a'),
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = size * 0.1;
    this.root.add(shadow, body, base, rim, this.water);

    // The catch: individual fish (body + tail) stacked in rings, revealed one by one as weight lands.
    const fishBody = new THREE.SphereGeometry(1, 8, 6);
    fishBody.scale(0.34, 0.2, 1);
    const tail = new THREE.ConeGeometry(0.34, 0.6, 4);
    tail.rotateX(-Math.PI / 2);
    tail.scale(1, 0.25, 1);
    tail.translate(0, 0, -1.2);
    const merged = new THREE.BufferGeometry();
    const parts = [fishBody.toNonIndexed(), tail.toNonIndexed()];
    for (const name of ['position', 'normal'] as const) {
      const arrays = parts.map((g) => g.getAttribute(name).array as Float32Array);
      const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
      let offset = 0;
      for (const a of arrays) {
        out.set(a, offset);
        offset += a.length;
      }
      merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
    }
    // Wet fish: a stepped highlight from whatever lights them (lantern, moon).
    this.heapMaterial = toon(ramp, { emissive: color('#000000') });
    this.heapMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float sheen = pow(clamp(dot(normalize(normal), normalize(normalize(vViewPosition) + vec3(-0.3, 0.8, 0.5))), 0.0, 1.0), 18.0);
         totalEmissiveRadiance += vec3(0.55, 0.62, 0.6) * (sheen > 0.5 ? 0.5 : (sheen > 0.2 ? 0.18 : 0.0)) * diffuseColor.rgb * 2.0;`,
      );
    };
    this.heapMaterial.customProgramCacheKey = () => 'basket-heap';
    this.heap = new THREE.InstancedMesh(merged, this.heapMaterial, HEAP_FISH);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tints = ['#9fd0cf', '#6fb0b8', '#b5ddd6', '#f08a24', '#84c2c4', '#ffc24a', '#5f9faa'];
    for (let i = 0; i < HEAP_FISH; i++) {
      // Deterministic pile: rings that climb and tighten, each fish lying at its own angle.
      const layerIndex = Math.floor(i / 6);
      const a = i * 2.39996;
      const r = size * (0.4 - layerIndex * 0.05) * (i % 6 === 0 ? 0.25 : 1);
      q.setFromEuler(new THREE.Euler(Math.sin(i * 1.7) * 0.5, a * 1.3, Math.cos(i * 2.3) * 0.5));
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, size * (0.14 + layerIndex * 0.19), Math.sin(a) * r),
        q,
        new THREE.Vector3(1, 1, 1).multiplyScalar(size * 0.36),
      );
      this.heap.setMatrixAt(i, m);
      this.rest.push(m.clone());
      const tint = color(tints[i % tints.length] ?? '#9fd0cf');
      this.tints.push(tint);
      this.heap.setColorAt(i, tint);
    }
    this.heap.count = 0;
    this.heap.frustumCulled = false;
    this.root.add(this.heap);
    this.root.traverse((o) => o.layers.set(layer));
  }

  /**
   * fill 0..1 = landed weight toward the goal (fish appear one at a time, so the heap grows).
   * `fry` 0..1 chars the catch after an eel; `glow` 0..1 turns it gold on a win.
   */
  update(fill: number, dt: number, time = 0, fry = 0, glow = 0): void {
    this.shown += (fill - this.shown) * (1 - Math.exp(-6 * dt));
    const count = this.shown > 0.002 ? Math.min(HEAP_FISH, 1 + Math.floor(this.shown * (HEAP_FISH - 1) + 0.5)) : 0;
    this.heap.count = count;
    this.water.visible = count > 0;
    // Now and then the top fish gives a flop.
    if (count > 0) {
      const top = count - 1;
      const beat = (time * 0.6) % 4;
      const kick = fry > 0 ? Math.sin(time * 40) * 0.25 * (1 - fry) : beat < 0.35 ? Math.sin((beat / 0.35) * Math.PI * 3) * 0.5 : 0;
      const m = this.scratch.copy(this.rest[top] as THREE.Matrix4).multiply(this.spin.makeRotationX(kick));
      this.heap.setMatrixAt(top, m);
      this.heap.instanceMatrix.needsUpdate = true;
    }
    const state = Math.round(fry * 20) + Math.round(glow * 20) * 100;
    if (state !== this.fried) {
      this.fried = state;
      this.tints.forEach((tint, i) =>
        this.heap.setColorAt(
          i,
          this.mixed
            .copy(tint)
            .lerp(this.char, fry * 0.92)
            .lerp(this.gold, glow * 0.7),
        ),
      );
      if (this.heap.instanceColor) this.heap.instanceColor.needsUpdate = true;
      // Gold, but under the bloom threshold: it should read as a glowing catch, not a lamp.
      this.heapMaterial.emissive.copy(this.gold).multiplyScalar(glow * 0.22);
    }
    this.root.updateMatrixWorld(true);
    this.mouth.set(0, this.size * 1.2, 0).applyMatrix4(this.root.matrixWorld);
  }

  private readonly scratch = new THREE.Matrix4();
  private readonly spin = new THREE.Matrix4();
  private readonly mixed = new THREE.Color();
}

const HEAP_FISH = 30;
