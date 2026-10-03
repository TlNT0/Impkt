import * as THREE from 'three';

// Actual yarn geometry: the silhouette and grazing highlights cannot be
// supplied by a normal map. All loops share one small mesh and one draw call.
export function cottonPile(band, wobble, material, dark = false) {
  let seed = 731;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.13, 0, -0.035),
    new THREE.Vector3(-0.17, 0.035, 0.085),
    new THREE.Vector3(-0.045, 0.065, 0.17),
    new THREE.Vector3(0.12, 0.025, 0.12),
    new THREE.Vector3(0.13, 0, -0.035)
  ]);
  const geometry = new THREE.TubeGeometry(path, 7, 0.042, 5, false);
  const rows = 64, columns = 460;
  const pile = new THREE.InstancedMesh(geometry, material, rows * columns);
  const matrix = new THREE.Matrix4(), basis = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), twist = new THREE.Quaternion();
  const x = new THREE.Vector3(1, 0, 0), y = new THREE.Vector3(), z = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 0, 1), color = new THREE.Color();
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const ax = ((row + 0.5 + (random() - 0.5) * 0.55) / rows - 0.5) * band.W;
      const th = (column + (row % 2) * 0.5 + random() * 0.6) / columns * Math.PI * 2;
      const r = band.RO + wobble(th, ax / band.W);
      position.set(ax + band.cx, band.cy + r * Math.sin(th), band.cz + r * Math.cos(th));
      y.set(0, Math.cos(th), -Math.sin(th));
      z.set(0, Math.sin(th), Math.cos(th));
      basis.makeBasis(x, y, z);
      rotation.setFromRotationMatrix(basis);
      twist.setFromAxisAngle(normal, (random() - 0.5) * 0.7 + (row % 2 ? 0.25 : -0.25));
      rotation.multiply(twist);
      const size = 0.78 + random() * 0.38;
      scale.set(size, size, 0.55 + random() * 0.85);
      const index = row * columns + column;
      pile.setMatrixAt(index, matrix.compose(position, rotation, scale));
      const shade = (dark ? 0.85 : 0.88) + random() * 0.12;
      color.setRGB(shade, shade * 0.985, shade * 0.965);
      pile.setColorAt(index, color);
    }
  }
  pile.instanceMatrix.needsUpdate = true;
  pile.instanceColor.needsUpdate = true;
  pile.computeBoundingSphere();
  return pile;
}

// A fine knitted backing, with rounded yarn ridges instead of cloudy noise.
export function knitMaps(contrast = 0.35) {
  const n = 512, tile = 8;
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n * 16, v = y / n * 16;
    const row = Math.floor(v);
    const dx = (u + (row % 2) * 0.5) % 1 - 0.5;
    const dy = v % 1;
    const ridge = Math.exp(-Math.pow((Math.abs(dx) - 0.30 * Math.sin(dy * Math.PI)) / 0.095, 2));
    height[y * n + x] = ridge * Math.pow(Math.sin(dy * Math.PI), 0.35);
  }
  const normal = new Uint8Array(n * n * 4), tint = new Uint8Array(n * n * 4);
  const rough = new Uint8Array(n * n * 4);
  const get = (x, y) => height[((y + n) % n) * n + (x + n) % n];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, h = get(x, y);
    const dx = (get(x + 1, y) - get(x - 1, y)) * 1.6;
    const dy = (get(x, y + 1) - get(x, y - 1)) * 1.6;
    const length = Math.hypot(dx, dy, 1);
    normal.set([128 - dx / length * 127, 128 - dy / length * 127, 128 + 127 / length, 255], i);
    const shade = 255 * (1 - contrast * (1 - h));
    tint.set([shade, shade, shade, 255], i);
    rough.set([240 - h * 20, 240 - h * 20, 240 - h * 20, 255], i);
  }
  const texture = data => {
    const map = new THREE.DataTexture(data, n, n);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1 / tile, 1 / tile);
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    return map;
  };
  const color = texture(tint);
  color.colorSpace = THREE.SRGBColorSpace;
  return { normal: texture(normal), tint: color, rough: texture(rough) };
}

export function finishGrain(brushed = false) {
  const size = 256, data = new Uint8Array(size * size * 4);
  let seed = 94;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const lines = Array.from({ length: size }, random);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = 95 + 64 * (brushed ? lines[y] * 0.8 + random() * 0.2 : random());
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.15, 0.15);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function satinThreads(polygons, onBand, material) {
  const positions = [], normals = [];
  for (const polygon of polygons) {
    const mm = polygon.map(([x, y]) => [(x - 23.6) * 14 / 44, (22 - y) * 14 / 44]);
    const p = mm[3], a = [mm[2][0] - p[0], mm[2][1] - p[1]];
    const b = [mm[0][0] - p[0], mm[0][1] - p[1]];
    const count = Math.ceil(Math.hypot(...b) / 0.23);
    for (let row = 0; row < count; row++) {
      const v = (row + 0.5) / count;
      const points = [];
      for (let j = 0; j <= 12; j++) {
        const u = j / 12;
        points.push(onBand(12 + p[0] + a[0] * u + b[0] * v,
          p[1] + a[1] * u + b[1] * v,
          0.46 + 0.07 * Math.sin(Math.PI * u)));
      }
      const thread = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.068, 5, false);
      const flat = thread.toNonIndexed();
      positions.push(...flat.attributes.position.array);
      normals.push(...flat.attributes.normal.array);
      flat.dispose(); thread.dispose();
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return new THREE.Mesh(geometry, material);
}

// ExtrudeGeometry duplicates vertices at every face. Average only the shallow
// joins of a fillet, retaining a hard normal wherever the angle exceeds 60°.
export function smoothBevelNormals(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const groups = new Map();
  const keys = new Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    keys[i] = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const output = new Float32Array(n.array.length);
  const source = new THREE.Vector3(), other = new THREE.Vector3(), sum = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    source.fromBufferAttribute(n, i);
    sum.set(0, 0, 0);
    for (const j of groups.get(keys[i])) {
      other.fromBufferAttribute(n, j);
      if (source.dot(other) > 0.5) sum.add(other);
    }
    sum.normalize().toArray(output, i * 3);
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(output, 3));
}

// Structured cap rings give the pouch enough vertices to bend smoothly without
// recursively splitting every small bevel triangle along with the cap.
export function pouchBody(width, length, thickness, material) {
  const radius = 1, bevel = 0.24, segments = 128;
  const outline = (w, h, r) => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return shape.getSpacedPoints(segments).slice(0, segments);
  };
  const rings = [];
  const cap = outline(width - 2 * bevel, length - 2 * bevel, radius - bevel);
  for (let i = 1; i <= 24; i++) rings.push(cap.map(p => [p.x * i / 24, p.y * i / 24, thickness / 2]));
  for (let i = 1; i <= 6; i++) {
    const a = i / 6 * Math.PI / 2, grow = bevel * Math.sin(a);
    rings.push(outline(width - 2 * bevel + 2 * grow, length - 2 * bevel + 2 * grow, radius - bevel + grow)
      .map(p => [p.x, p.y, thickness / 2 - bevel + bevel * Math.cos(a)]));
  }
  for (let i = 6; i >= 0; i--) {
    const a = i / 6 * Math.PI / 2, grow = bevel * Math.sin(a);
    rings.push(outline(width - 2 * bevel + 2 * grow, length - 2 * bevel + 2 * grow, radius - bevel + grow)
      .map(p => [p.x, p.y, -thickness / 2 + bevel - bevel * Math.cos(a)]));
  }
  for (let i = 23; i >= 1; i--) rings.push(cap.map(p => [p.x * i / 24, p.y * i / 24, -thickness / 2]));
  const positions = [], uv = [], indices = [];
  rings.forEach(ring => ring.forEach(([x, y, z]) => { positions.push(x, y, z); uv.push(x, y); }));
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < segments; i++) {
    const a = r * segments + i, b = r * segments + (i + 1) % segments;
    indices.push(a, a + segments, b, b, a + segments, b + segments);
  }
  for (const end of [0, 1]) {
    const center = positions.length / 3, offset = end ? (rings.length - 1) * segments : 0;
    positions.push(0, 0, (end ? -1 : 1) * thickness / 2); uv.push(0, 0);
    for (let i = 0; i < segments; i++) {
      const a = offset + i, b = offset + (i + 1) % segments;
      indices.push(center, end ? b : a, end ? a : b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.curvedReady = true;
  return mesh;
}

// Restrained laser lettering on the package. No invented manufacturer or part
// number: these are product and functional labels for the visualisation.
export function packageMark() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8b8e88';
  ctx.font = '500 88px monospace';
  ctx.fillText('IMPKT', 200, 380);
  ctx.font = '46px monospace';
  ctx.fillText('WIRELESS', 200, 466);
  ctx.font = '36px monospace';
  ctx.fillText('U1', 200, 650);
  // The same microscopic, deterministic dropout as a shallow laser mark.
  let seed = 1987;
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % 1024;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    ctx.fillRect(x, seed % 1024, 1, 1);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 0.86,
    metalness: 0, polygonOffset: true, polygonOffsetFactor: -1,
    polygonOffsetUnits: -1, opacity: 0.64
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(6.8, 6.8, 8, 8), material);
}
