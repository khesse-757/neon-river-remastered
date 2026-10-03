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
    this.head.position.y += lift * this.radius * 1.1;
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

  update(time: number, flicker: number): void {
    this.hanger.rotation.z = Math.sin(time * 1.3) * 0.11;
    this.hanger.rotation.x = Math.sin(time * 0.9 + 1.2) * 0.06;
    this.paper.emissiveIntensity = 1.15 + flicker * 0.5;
    this.root.updateMatrixWorld(true);
    this.flame.set(0, -1.25 * this.size, 0).applyMatrix4(this.hanger.matrixWorld);
  }
}

export class BasketProp {
  readonly root = new THREE.Group();
  /** World position fish are tossed to. */
  readonly mouth = new THREE.Vector3();
  private readonly pile: THREE.Mesh;
  private readonly tails: THREE.Mesh[] = [];
  private shown = 0;

  constructor(ramp: THREE.Texture, size: number, layer: number) {
    this.size = size;
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
    const base = new THREE.Mesh(new THREE.CircleGeometry(size * 0.7, 16), toon(ramp, { color: color('#3a2a16') }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = size * 0.02;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(size * 0.97, size * 0.07, 6, 20), toon(ramp, { color: color('#5a3f20') }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = size * 1.02;
    // The catch: a silver-blue heap that rises as the basket fills, with a few tails showing.
    this.pile = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      toon(ramp, { color: color('#8fb9c4') }),
    );
    this.pile.scale.set(1, 0.001, 1);
    this.root.add(body, base, rim, this.pile);
    const tailGeometry = new THREE.ConeGeometry(size * 0.16, size * 0.42, 4);
    const tints = ['#7fb6b0', '#f08a24', '#3f8f96', '#ffc24a', '#2c6f7d'];
    tints.forEach((hex, i) => {
      const tail = new THREE.Mesh(tailGeometry, toon(ramp, { color: color(hex) }));
      const a = (i / tints.length) * Math.PI * 2 + 0.6;
      tail.position.set(Math.cos(a) * size * 0.45, 0, Math.sin(a) * size * 0.45);
      tail.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5);
      tail.visible = false;
      this.tails.push(tail);
      this.root.add(tail);
    });
    this.root.traverse((o) => o.layers.set(layer));
  }

  private readonly size: number;

  /** fill 0..1 = caught weight toward the goal. Eased so the heap grows, not jumps. */
  update(fill: number, dt: number): void {
    this.shown += (fill - this.shown) * (1 - Math.exp(-4 * dt));
    const level = this.size * (0.12 + this.shown * 0.95);
    // Empty basket shows its dark base; the heap only appears once fish have landed.
    const spread = 0.35 + 0.65 * Math.sqrt(this.shown);
    this.pile.visible = this.shown > 0.004;
    this.pile.position.y = level * 0.5;
    this.pile.scale.set(spread, 0.12 + this.shown * 0.6, spread);
    this.tails.forEach((tail, i) => {
      tail.visible = this.shown > 0.03 + i * 0.16;
      tail.position.y = level + this.size * 0.1;
    });
    this.root.updateMatrixWorld(true);
    this.mouth.set(0, this.size * 1.2, 0).applyMatrix4(this.root.matrixWorld);
  }
}
