// src/proxy/voxelizer.ts
var EXTRACTION_MARGIN = 2;
var defaultProxySettings = Object.freeze({
  surface: "smooth",
  voxelSize: 0.025,
  opacityThreshold: 0.04,
  dilate: 0,
  smoothIterations: 3,
  floorFill: false,
  mergeCoplanar: false,
  maxVoxels: 4e6
});
var BONE_KEY_STRIDE = 1 << 20;
var INFLUENCES = 4;
function buildVoxelGrid(input, settings = {}) {
  const t0 = now();
  const s = { ...defaultProxySettings, ...stripUndefined(settings) };
  if (!(s.voxelSize > 0)) {
    throw new RangeError(`[buildVoxelGrid] voxelSize must be > 0, got ${s.voxelSize}`);
  }
  const grid = voxelize(input, s, false, t0, "[buildVoxelGrid]");
  return {
    occupancy: grid.occupancy,
    dims: grid.dims,
    origin: grid.origin,
    voxelSize: grid.voxelSize,
    requestedVoxelSize: grid.requestedVoxelSize,
    coarsened: grid.coarsened,
    occupiedVoxels: grid.occupiedVoxels,
    splatsUsed: grid.splatsUsed,
    buildMs: grid.buildMs
  };
}
function voxelize(input, s, skinned, t0, label) {
  const positions = input.positions;
  const n = Math.floor(positions.length / 3);
  if (n === 0) return emptyGrid(s.voxelSize, t0);
  const opacities = input.opacities;
  const hasOpacity = !!opacities && opacities.length === n;
  const threshold = s.opacityThreshold;
  const srcBoneIndices = skinned ? input.boneIndices : null;
  const srcBoneWeights = skinned ? input.boneWeights : null;
  if (srcBoneIndices && srcBoneWeights) {
    const want = n * INFLUENCES;
    if (srcBoneIndices.length < want || srcBoneWeights.length < want) {
      throw new RangeError(
        `${label} bone arrays must carry ${INFLUENCES} influences per splat: expected ${want} entries for ${n} splats, got ${srcBoneIndices.length} indices and ${srcBoneWeights.length} weights`
      );
    }
  }
  let rawMnx = Infinity, rawMny = Infinity, rawMnz = Infinity;
  let rawMxx = -Infinity, rawMxy = -Infinity, rawMxz = -Infinity;
  let splatsUsed = 0;
  for (let i = 0; i < n; i++) {
    if (hasOpacity && opacities[i] < threshold) continue;
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < rawMnx) rawMnx = x;
    if (x > rawMxx) rawMxx = x;
    if (y < rawMny) rawMny = y;
    if (y > rawMxy) rawMxy = y;
    if (z < rawMnz) rawMnz = z;
    if (z > rawMxz) rawMxz = z;
    splatsUsed++;
  }
  if (splatsUsed === 0) return emptyGrid(s.voxelSize, t0);
  let mnx = 0, mny = 0, mnz = 0, mxx = 0, mxy = 0, mxz = 0;
  const requestedVoxelSize = s.voxelSize;
  let voxel = s.voxelSize;
  let nx = 0, ny = 0, nz = 0;
  const sizeGrid = () => {
    const pad = (s.dilate + EXTRACTION_MARGIN) * voxel;
    mnx = rawMnx - pad;
    mny = rawMny - pad;
    mnz = rawMnz - pad;
    mxx = rawMxx + pad;
    mxy = rawMxy + pad;
    mxz = rawMxz + pad;
    nx = Math.ceil((mxx - mnx) / voxel) + 1;
    ny = Math.ceil((mxy - mny) / voxel) + 1;
    nz = Math.ceil((mxz - mnz) / voxel) + 1;
  };
  sizeGrid();
  let cells = nx * ny * nz;
  while (cells > s.maxVoxels) {
    voxel *= 1.5;
    sizeGrid();
    const next = nx * ny * nz;
    if (next >= cells) break;
    cells = next;
  }
  const nvox = nx * ny * nz;
  const idx = (x, y, z) => (z * ny + y) * nx + x;
  let occ = new Uint8Array(nvox);
  const boneSlot = srcBoneIndices ? new Int32Array(nvox).fill(-1) : null;
  const boneAcc = srcBoneIndices ? /* @__PURE__ */ new Map() : null;
  let slotCount = 0;
  const invVoxel = 1 / voxel;
  for (let i = 0; i < n; i++) {
    if (hasOpacity && opacities[i] < threshold) continue;
    let cx = Math.floor((positions[i * 3] - mnx) * invVoxel);
    let cy = Math.floor((positions[i * 3 + 1] - mny) * invVoxel);
    let cz = Math.floor((positions[i * 3 + 2] - mnz) * invVoxel);
    if (cx < 0) cx = 0;
    else if (cx >= nx) cx = nx - 1;
    if (cy < 0) cy = 0;
    else if (cy >= ny) cy = ny - 1;
    if (cz < 0) cz = 0;
    else if (cz >= nz) cz = nz - 1;
    const vi = idx(cx, cy, cz);
    occ[vi] = 1;
    if (!boneSlot || !boneAcc) continue;
    let slot = boneSlot[vi];
    if (slot < 0) {
      slot = slotCount++;
      boneSlot[vi] = slot;
    }
    const base = i * INFLUENCES;
    for (let j = 0; j < INFLUENCES; j++) {
      const w = srcBoneWeights[base + j];
      if (!(w > 0)) continue;
      const bone = srcBoneIndices[base + j];
      if (bone < 0 || bone >= BONE_KEY_STRIDE) {
        throw new RangeError(
          `${label} bone index ${bone} is out of the packable range [0, ${BONE_KEY_STRIDE})`
        );
      }
      const key = slot * BONE_KEY_STRIDE + bone;
      boneAcc.set(key, (boneAcc.get(key) ?? 0) + w);
    }
  }
  for (let pass = 0; pass < s.dilate; pass++) {
    const grown = occ.slice();
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const vi = idx(x, y, z);
          if (occ[vi]) continue;
          let src = -1;
          if (occ[idx(x - 1, y, z)]) src = idx(x - 1, y, z);
          else if (occ[idx(x + 1, y, z)]) src = idx(x + 1, y, z);
          else if (occ[idx(x, y - 1, z)]) src = idx(x, y - 1, z);
          else if (occ[idx(x, y + 1, z)]) src = idx(x, y + 1, z);
          else if (occ[idx(x, y, z - 1)]) src = idx(x, y, z - 1);
          else if (occ[idx(x, y, z + 1)]) src = idx(x, y, z + 1);
          if (src < 0) continue;
          grown[vi] = 1;
          if (boneSlot && boneSlot[vi] < 0) boneSlot[vi] = boneSlot[src];
        }
      }
    }
    occ = grown;
  }
  if (s.floorFill) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        let lowest = -1;
        for (let y = 0; y < ny; y++) {
          if (occ[idx(x, y, z)]) {
            lowest = y;
            break;
          }
        }
        for (let y = EXTRACTION_MARGIN; y < lowest; y++) occ[idx(x, y, z)] = 1;
      }
    }
  }
  let occupiedVoxels = 0;
  for (let i = 0; i < nvox; i++) if (occ[i]) occupiedVoxels++;
  let slotIndices = null;
  let slotWeights = null;
  if (boneAcc && occupiedVoxels > 0) {
    slotIndices = new Float32Array(slotCount * INFLUENCES);
    slotWeights = new Float32Array(slotCount * INFLUENCES);
    for (const [key, total] of boneAcc) {
      const slot = Math.floor(key / BONE_KEY_STRIDE);
      const bone = key - slot * BONE_KEY_STRIDE;
      const base = slot * INFLUENCES;
      let worst = 0;
      for (let j = 1; j < INFLUENCES; j++) {
        if (slotWeights[base + j] < slotWeights[base + worst]) worst = j;
      }
      if (total > slotWeights[base + worst]) {
        slotWeights[base + worst] = total;
        slotIndices[base + worst] = bone;
      }
    }
    for (let slot = 0; slot < slotCount; slot++) {
      const base = slot * INFLUENCES;
      let sum = 0;
      for (let j = 0; j < INFLUENCES; j++) sum += slotWeights[base + j];
      if (sum <= 0) continue;
      for (let j = 0; j < INFLUENCES; j++) slotWeights[base + j] /= sum;
    }
  }
  return {
    occupancy: occ,
    dims: { x: nx, y: ny, z: nz },
    origin: { x: mnx, y: mny, z: mnz },
    voxelSize: voxel,
    requestedVoxelSize,
    coarsened: voxel > requestedVoxelSize * 1.001,
    occupiedVoxels,
    splatsUsed,
    buildMs: now() - t0,
    boneSlot,
    slotIndices,
    slotWeights
  };
}
function emptyGrid(voxelSize, t0) {
  return {
    occupancy: new Uint8Array(0),
    dims: { x: 0, y: 0, z: 0 },
    origin: { x: 0, y: 0, z: 0 },
    voxelSize,
    requestedVoxelSize: voxelSize,
    coarsened: false,
    occupiedVoxels: 0,
    splatsUsed: 0,
    buildMs: now() - t0,
    boneSlot: null,
    slotIndices: null,
    slotWeights: null
  };
}
var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
function stripUndefined(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) if (v !== void 0) out[k] = v;
  return out;
}

// src/collider/collider-grid.ts
var COLLIDER_VOXEL_METRES = 0.1;
var COLLIDER_BAND_BELOW_M = 1;
var COLLIDER_BAND_ABOVE_M = 3;
var COLLIDER_OPACITY_THRESHOLD = 0.1;
var COLLIDER_DILATE = 1;
var COLLIDER_SAMPLE_POINTS = 2e5;
var FLOOR_PERCENTILE = 0.05;
var COLLIDER_MAX_VOXELS = 4e6;
var MIN_POINTS = 100;
var COLLIDER_ISLAND_KEEP_FRACTION = 0.05;
var DEFAULT_COLLIDER_TUNING = Object.freeze({
  samplePoints: COLLIDER_SAMPLE_POINTS,
  voxelMetres: COLLIDER_VOXEL_METRES,
  dilate: COLLIDER_DILATE,
  bandBelowM: COLLIDER_BAND_BELOW_M,
  bandAboveM: COLLIDER_BAND_ABOVE_M,
  opacityThreshold: COLLIDER_OPACITY_THRESHOLD
});
var COLLIDER_TUNING_LIMITS = Object.freeze({
  samplePoints: { min: 2e4, max: 5e5, step: 1e4 },
  voxelMetres: { min: 0.01, max: 1, step: 1e-3 },
  dilate: { min: 0, max: 3, step: 1 },
  bandBelowM: { min: 0.25, max: 4, step: 0.25 },
  bandAboveM: { min: 1.5, max: 12, step: 0.25 },
  opacityThreshold: { min: 0, max: 0.9, step: 0.01 }
});
function clampColliderTuning(t) {
  const out = { ...DEFAULT_COLLIDER_TUNING };
  if (!t) return out;
  for (const key of Object.keys(out)) {
    const v = t[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const { min, max } = COLLIDER_TUNING_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, v));
  }
  out.dilate = Math.round(out.dilate);
  out.samplePoints = Math.round(out.samplePoints);
  return out;
}
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
}
var now2 = () => typeof performance === "undefined" ? Date.now() : performance.now();
function buildColliderData(sample, frame, tuning = {}, walker = null) {
  const t0 = now2();
  const t = clampColliderTuning(tuning);
  const scale = frame.scale;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const points = sample.positions;
  const n = Math.floor(points.length / 3);
  if (n < MIN_POINTS) return null;
  const voxelLocal = t.voxelMetres / scale;
  const bandBelowLocal = t.bandBelowM / scale;
  const bandAboveLocal = t.bandAboveM / scale;
  if (!(voxelLocal > 0)) return null;
  const ox = frame.origin.x, oy = frame.origin.y, oz = frame.origin.z;
  const inv = 1 / scale;
  const alpha = sample.alpha;
  const hasAlpha = !!alpha && alpha.length >= n && t.opacityThreshold > 0;
  const solid = hasAlpha ? new Uint8Array(n) : null;
  let solidCount = n;
  if (solid) {
    solidCount = 0;
    for (let i = 0; i < n; i++) {
      if (alpha[i] < t.opacityThreshold) continue;
      solid[i] = 1;
      solidCount++;
    }
    if (solidCount < MIN_POINTS) return null;
  }
  const belowThresholdPoints = n - solidCount;
  const ys = new Float32Array(solidCount);
  for (let i = 0, w = 0; i < n; i++) {
    if (solid && !solid[i]) continue;
    ys[w++] = (points[i * 3 + 1] - oy) * inv;
  }
  ys.sort();
  const floorRefY = quantile(ys, FLOOR_PERCENTILE);
  const bandMinY = floorRefY - bandBelowLocal;
  const bandMaxY = floorRefY + bandAboveLocal;
  const band = new Float32Array(solidCount * 3);
  let bandPoints = 0;
  for (let i = 0; i < n; i++) {
    if (solid && !solid[i]) continue;
    const y = (points[i * 3 + 1] - oy) * inv;
    if (y < bandMinY || y > bandMaxY) continue;
    band[bandPoints * 3] = (points[i * 3] - ox) * inv;
    band[bandPoints * 3 + 1] = y;
    band[bandPoints * 3 + 2] = (points[i * 3 + 2] - oz) * inv;
    bandPoints++;
  }
  if (bandPoints < MIN_POINTS) return null;
  const grid = buildVoxelGrid({ positions: band.subarray(0, bandPoints * 3) }, {
    voxelSize: voxelLocal,
    // The threshold is applied above, not handed down: the band crop and the
    // floor percentile both have to see the filtered set, so by the time the
    // voxelizer gets the points there is nothing left for it to reject.
    dilate: t.dilate,
    // A grid lookup reads the TOPMOST occupied cell in a column, so filling
    // underneath changes no answer it can give. Floor fill is for fast
    // rigidbodies tunnelling through a one-voxel shell, and there are none
    // here - and on a band-cropped grid it would fill the whole metre below
    // the floor solid for nothing.
    floorFill: false,
    maxVoxels: COLLIDER_MAX_VOXELS
  });
  const cells = grid.dims.x * grid.dims.y * grid.dims.z;
  if (grid.occupiedVoxels === 0 || grid.occupancy.length !== cells) return null;
  const seedLocal = walker ? { x: (walker.x - ox) * inv, y: (walker.y - oy) * inv, z: (walker.z - oz) * inv } : null;
  const islands = dropIslands(grid.occupancy, grid.dims, grid.origin, grid.voxelSize, seedLocal);
  const surfaceVoxels = grid.occupiedVoxels - islands.voxels;
  const sealedVoxels = seedLocal ? sealUnreachable(
    grid.occupancy,
    grid.dims,
    grid.origin,
    grid.voxelSize,
    seedLocal,
    walker.radius * inv,
    (walker.height ?? 0) * inv,
    // Nothing taller than her body is climbed; without a height, any air is.
    walker.height ? walker.height * inv : Infinity
  ) : 0;
  const occupiedVoxels = surfaceVoxels + sealedVoxels;
  return {
    version: 1,
    occupancy: grid.occupancy,
    dims: grid.dims,
    gridOrigin: grid.origin,
    voxelSize: grid.voxelSize,
    floorRefY,
    bandMinY,
    bandMaxY,
    tuning: t,
    builtFrame: { origin: { x: ox, y: oy, z: oz }, scale },
    stats: {
      voxelMetres: grid.voxelSize * scale,
      requestedVoxelMetres: t.voxelMetres,
      coarsened: grid.coarsened,
      dims: grid.dims,
      cells,
      occupiedVoxels,
      islandsDropped: islands.count,
      islandVoxelsDropped: islands.voxels,
      sealedVoxels,
      samplePoints: n,
      hasAlpha: !!alpha && alpha.length >= n,
      belowThresholdPoints,
      bandPoints,
      pointsPerCell: bandPoints / surfaceVoxels,
      buildMs: now2() - t0
    }
  };
}
var SEED_SEARCH_CELLS = 6;
function dropIslands(occ, dims, origin, voxelSize, seed) {
  const nx = dims.x, ny = dims.y, nz = dims.z;
  const labels = new Int32Array(occ.length);
  const sizes = [0];
  let solid = 0;
  for (let i = 0; i < occ.length; i++) if (occ[i]) solid++;
  const queue = new Int32Array(solid);
  for (let start = 0; start < occ.length; start++) {
    if (!occ[start] || labels[start]) continue;
    const label = sizes.length;
    let head = 0, tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const i = queue[head++];
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= nz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= nx) continue;
            const j = (zz * ny + yy) * nx + xx;
            if (!occ[j] || labels[j]) continue;
            labels[j] = label;
            queue[tail++] = j;
          }
        }
      }
    }
    sizes.push(tail);
  }
  if (sizes.length <= 2) return { count: 0, voxels: 0 };
  let largest = 0;
  for (let l = 1; l < sizes.length; l++) if (sizes[l] > largest) largest = sizes[l];
  const keep = new Uint8Array(sizes.length);
  for (let l = 1; l < sizes.length; l++) {
    if (sizes[l] === largest || sizes[l] >= largest * COLLIDER_ISLAND_KEEP_FRACTION) keep[l] = 1;
  }
  const seedLabel = seed ? labelUnder(labels, dims, origin, voxelSize, seed) : 0;
  if (seedLabel) keep[seedLabel] = 1;
  let count = 0, voxels = 0;
  for (let l = 1; l < sizes.length; l++) {
    if (keep[l]) continue;
    count++;
    voxels += sizes[l];
  }
  if (count === 0) return { count, voxels };
  for (let i = 0; i < occ.length; i++) if (occ[i] && !keep[labels[i]]) occ[i] = 0;
  return { count, voxels };
}
function labelUnder(labels, dims, origin, voxelSize, seed) {
  const nx = dims.x, ny = dims.y, nz = dims.z;
  const cx = Math.floor((seed.x - origin.x) / voxelSize);
  const cz = Math.floor((seed.z - origin.z) / voxelSize);
  const top = Math.min(ny - 1, Math.floor((seed.y - origin.y) / voxelSize) + 1);
  if (top < 0) return 0;
  for (let r = 0; r <= SEED_SEARCH_CELLS; r++) {
    let best = -1, bestLabel = 0;
    for (let z = cz - r; z <= cz + r; z++) {
      if (z < 0 || z >= nz) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= nx) continue;
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
        for (let y = top; y > best; y--) {
          const l = labels[(z * ny + y) * nx + x];
          if (!l) continue;
          best = y;
          bestLabel = l;
          break;
        }
      }
    }
    if (bestLabel) return bestLabel;
  }
  return 0;
}
var SEAL_SEED_SEARCH_CELLS = 8;
var HOLE_BRIDGE_HEIGHTS = 0.4;
function sealUnreachable(occ, dims, origin, voxelSize, seed, radius, height = 0, climb = Infinity) {
  const nx = dims.x, ny = dims.y, nz = dims.z;
  const rCells = radius / voxelSize;
  const erode = Math.max(0, Math.floor(rCells / Math.SQRT2 - 1));
  let tight = erode > 0 ? growXZ(occ, dims, erode) : occ;
  if (Number.isFinite(climb)) {
    const maxGap = Math.ceil(climb / voxelSize);
    const feet = Math.floor((seed.y - origin.y) / voxelSize);
    const floored = new Uint8Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        for (let y = 0; y <= Math.min(ny - 1, feet + 1); y++) {
          if (occ[(z * ny + y) * nx + x]) {
            floored[z * nx + x] = 1;
            break;
          }
        }
      }
    }
    const hole = growXZ(floored, { x: nx, y: 1, z: nz }, Math.ceil(climb * HOLE_BRIDGE_HEIGHTS / voxelSize));
    tight = new Uint8Array(tight);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const bridged = hole[z * nx + x] === 1;
        let gap = -1;
        for (let y = 0; y < ny; y++) {
          const i = (z * ny + y) * nx + x;
          if (occ[i]) {
            gap = 0;
            continue;
          }
          if (gap >= 0) gap++;
          const closed = gap >= 0 ? gap > maxGap : !bridged || y < feet - 1 || y > feet + maxGap;
          if (closed) tight[i] = 1;
        }
      }
    }
  }
  const cx = Math.floor((seed.x - origin.x) / voxelSize);
  const cz = Math.floor((seed.z - origin.z) / voxelSize);
  const mid = Math.floor((seed.y + height * 0.5 - origin.y) / voxelSize);
  if (cx < 0 || cx >= nx || cz < 0 || cz >= nz) return 0;
  let start = -1;
  for (let d = 0; d <= SEAL_SEED_SEARCH_CELLS && start < 0; d++) {
    for (const y of d === 0 ? [mid] : [mid + d, mid - d]) {
      if (y < 0 || y >= ny) continue;
      const i = (cz * ny + y) * nx + cx;
      if (!tight[i]) {
        start = i;
        break;
      }
    }
  }
  if (start < 0) return 0;
  const reached = new Uint8Array(occ.length);
  const queue = new Int32Array(occ.length);
  let head = 0, tail = 0;
  queue[tail++] = start;
  reached[start] = 1;
  const row = nx, layer = nx * ny;
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / layer);
    if (x > 0) visit(i - 1);
    if (x < nx - 1) visit(i + 1);
    if (y > 0) visit(i - row);
    if (y < ny - 1) visit(i + row);
    if (z > 0) visit(i - layer);
    if (z < nz - 1) visit(i + layer);
  }
  function visit(j) {
    if (reached[j] || tight[j]) return;
    reached[j] = 1;
    queue[tail++] = j;
  }
  const bodyCells = Math.PI * Math.max(1, erode) ** 2 * Math.max(1, height / voxelSize);
  if (tail < bodyCells) return 0;
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let below = false;
      for (let y = 0; y < ny; y++) {
        const i = (z * ny + y) * nx + x;
        if (reached[i]) below = true;
        else if (occ[i]) below = false;
        else if (below) reached[i] = 1;
      }
      let above = false;
      for (let y = ny - 1; y >= 0; y--) {
        const i = (z * ny + y) * nx + x;
        if (reached[i]) above = true;
        else if (occ[i]) above = false;
        else if (above) reached[i] = 1;
      }
    }
  }
  const body = growXZ(reached, dims, Math.ceil(rCells) + 1);
  let sealed = 0;
  for (let i = 0; i < occ.length; i++) {
    if (occ[i] || body[i]) continue;
    occ[i] = 1;
    sealed++;
  }
  return sealed;
}
function growXZ(src, dims, k) {
  const nx = dims.x, ny = dims.y, nz = dims.z;
  const alongX = new Uint8Array(src.length);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const base = (z * ny + y) * nx;
      let count = 0;
      for (let x = 0; x < Math.min(k, nx); x++) count += src[base + x];
      for (let x = 0; x < nx; x++) {
        if (x + k < nx) count += src[base + x + k];
        if (x - k - 1 >= 0) count -= src[base + x - k - 1];
        alongX[base + x] = count > 0 ? 1 : 0;
      }
    }
  }
  const out = new Uint8Array(src.length);
  const stride = nx * ny;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const base = y * nx + x;
      let count = 0;
      for (let z = 0; z < Math.min(k, nz); z++) count += alongX[base + z * stride];
      for (let z = 0; z < nz; z++) {
        if (z + k < nz) count += alongX[base + (z + k) * stride];
        if (z - k - 1 >= 0) count -= alongX[base + (z - k - 1) * stride];
        out[base + z * stride] = count > 0 ? 1 : 0;
      }
    }
  }
  return out;
}

// src/collider/collider-worker.ts
self.onmessage = (e) => {
  const req = e.data;
  try {
    const data = buildColliderData(
      { positions: req.positions, alpha: req.alpha },
      req.frame,
      req.tuning,
      req.walker ?? null
    );
    const response = { ok: true, data };
    self.postMessage(
      response,
      data ? [data.occupancy.buffer] : []
    );
  } catch (err) {
    const response = {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(response);
  }
};
//# sourceMappingURL=collider-worker.js.map
