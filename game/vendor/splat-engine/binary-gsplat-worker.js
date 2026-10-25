// src/loader/character/types.ts
var CharacterBundleError = class extends Error {
  category;
  constructor(category, message) {
    super(`[${category}] ${message}`);
    this.name = "CharacterBundleError";
    this.category = category;
  }
};

// src/loader/character/legacy/interleaved-splat.ts
var CHARACTER_BUNDLE_MAGIC = "VFCHARB1";
var FIRST_PLANAR_VERSION = 3;
var SH_C0 = 0.28209479177387814;
var _f16Buf = new ArrayBuffer(4);
var _f16U32 = new Uint32Array(_f16Buf);
var _f16F32 = new Float32Array(_f16Buf);
function f16ToF32(h) {
  const sign = (h & 32768) << 16;
  const exp = (h & 31744) >> 10;
  const frac = h & 1023;
  let bits;
  if (exp === 0) {
    if (frac === 0) {
      bits = sign;
    } else {
      let e = -14;
      let m = frac;
      while ((m & 1024) === 0) {
        m <<= 1;
        e--;
      }
      m &= 1023;
      bits = sign | e + 127 << 23 | m << 13;
    }
  } else if (exp === 31) {
    bits = sign | 2139095040 | frac << 13;
  } else {
    bits = sign | exp - 15 + 127 << 23 | frac << 13;
  }
  _f16U32[0] = bits;
  return _f16F32[0];
}
function parseBinaryGsplat(bundleBuffer) {
  if (bundleBuffer.byteLength < 12) {
    throw new Error("Character bundle too small");
  }
  const bundleView = new DataView(bundleBuffer);
  const magic = new TextDecoder().decode(new Uint8Array(bundleBuffer, 0, CHARACTER_BUNDLE_MAGIC.length));
  if (magic !== CHARACTER_BUNDLE_MAGIC) {
    throw new Error(`Invalid character bundle magic: ${magic}`);
  }
  const headerLength = bundleView.getUint32(CHARACTER_BUNDLE_MAGIC.length, true);
  const headerStart = CHARACTER_BUNDLE_MAGIC.length + 4;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > bundleBuffer.byteLength) {
    throw new Error("Character bundle header length out of range");
  }
  const headerText = new TextDecoder().decode(new Uint8Array(bundleBuffer, headerStart, headerLength));
  const header = JSON.parse(headerText);
  if (header.format !== "vfa3d-charbin") {
    throw new Error(`Unsupported character bundle format: ${header.format}`);
  }
  if (header.version >= FIRST_PLANAR_VERSION) {
    throw new Error(
      `Character bundle declares version ${header.version} under the ${CHARACTER_BUNDLE_MAGIC} magic; planar payloads must be published as VFCHARB2`
    );
  }
  const payloadStart = headerEnd;
  const chunkBuffer = (chunk) => {
    if (!chunk) return null;
    const start = payloadStart + chunk.offset;
    const end = start + chunk.length;
    if (start < payloadStart || end > bundleBuffer.byteLength || start > end) {
      throw new Error("Character bundle chunk range out of bounds");
    }
    return bundleBuffer.slice(start, end);
  };
  const numSplats = header.numSplats;
  const splatsBuffer = chunkBuffer(header.chunks.splats);
  if (!splatsBuffer) throw new Error("Missing splats chunk");
  const splatData = new DataView(splatsBuffer);
  const storage_x = new Float32Array(numSplats);
  const storage_y = new Float32Array(numSplats);
  const storage_z = new Float32Array(numSplats);
  const storage_scale_0 = new Float32Array(numSplats);
  const storage_scale_1 = new Float32Array(numSplats);
  const storage_scale_2 = new Float32Array(numSplats);
  const storage_rot_0 = new Float32Array(numSplats);
  const storage_rot_1 = new Float32Array(numSplats);
  const storage_rot_2 = new Float32Array(numSplats);
  const storage_rot_3 = new Float32Array(numSplats);
  const storage_f_dc_0 = new Float32Array(numSplats);
  const storage_f_dc_1 = new Float32Array(numSplats);
  const storage_f_dc_2 = new Float32Array(numSplats);
  const storage_opacity = new Float32Array(numSplats);
  const isFp16 = header.encoding?.precision === "fp16";
  let offset = 0;
  if (isFp16) {
    for (let i = 0; i < numSplats; i++) {
      storage_x[i] = f16ToF32(splatData.getUint16(offset + 0, true));
      storage_y[i] = f16ToF32(splatData.getUint16(offset + 2, true));
      storage_z[i] = f16ToF32(splatData.getUint16(offset + 4, true));
      offset += 6;
      const scaleX = f16ToF32(splatData.getUint16(offset + 0, true));
      const scaleY = f16ToF32(splatData.getUint16(offset + 2, true));
      const scaleZ = f16ToF32(splatData.getUint16(offset + 4, true));
      storage_scale_0[i] = Math.log(Math.max(scaleX, 1e-8));
      storage_scale_1[i] = Math.log(Math.max(scaleY, 1e-8));
      storage_scale_2[i] = Math.log(Math.max(scaleZ, 1e-8));
      offset += 6;
      const qx = f16ToF32(splatData.getUint16(offset + 0, true));
      const qy = f16ToF32(splatData.getUint16(offset + 2, true));
      const qz = f16ToF32(splatData.getUint16(offset + 4, true));
      const qw = f16ToF32(splatData.getUint16(offset + 6, true));
      storage_rot_0[i] = qw;
      storage_rot_1[i] = qx;
      storage_rot_2[i] = qy;
      storage_rot_3[i] = qz;
      offset += 8;
      const r = splatData.getUint8(offset + 0);
      const g = splatData.getUint8(offset + 1);
      const b = splatData.getUint8(offset + 2);
      storage_f_dc_0[i] = (r / 255 - 0.5) / SH_C0;
      storage_f_dc_1[i] = (g / 255 - 0.5) / SH_C0;
      storage_f_dc_2[i] = (b / 255 - 0.5) / SH_C0;
      offset += 4;
      const opacity = f16ToF32(splatData.getUint16(offset + 0, true));
      const clampedOpacity = Math.max(1e-4, Math.min(0.9999, opacity));
      storage_opacity[i] = -Math.log(1 / clampedOpacity - 1);
      offset += 2;
    }
  } else {
    for (let i = 0; i < numSplats; i++) {
      storage_x[i] = splatData.getFloat32(offset + 0, true);
      storage_y[i] = splatData.getFloat32(offset + 4, true);
      storage_z[i] = splatData.getFloat32(offset + 8, true);
      offset += 12;
      const scaleX = splatData.getFloat32(offset + 0, true);
      const scaleY = splatData.getFloat32(offset + 4, true);
      const scaleZ = splatData.getFloat32(offset + 8, true);
      storage_scale_0[i] = Math.log(Math.max(scaleX, 1e-8));
      storage_scale_1[i] = Math.log(Math.max(scaleY, 1e-8));
      storage_scale_2[i] = Math.log(Math.max(scaleZ, 1e-8));
      offset += 12;
      const qx = splatData.getFloat32(offset + 0, true);
      const qy = splatData.getFloat32(offset + 4, true);
      const qz = splatData.getFloat32(offset + 8, true);
      const qw = splatData.getFloat32(offset + 12, true);
      storage_rot_0[i] = qw;
      storage_rot_1[i] = qx;
      storage_rot_2[i] = qy;
      storage_rot_3[i] = qz;
      offset += 16;
      const r = splatData.getUint8(offset + 0);
      const g = splatData.getUint8(offset + 1);
      const b = splatData.getUint8(offset + 2);
      storage_f_dc_0[i] = (r / 255 - 0.5) / SH_C0;
      storage_f_dc_1[i] = (g / 255 - 0.5) / SH_C0;
      storage_f_dc_2[i] = (b / 255 - 0.5) / SH_C0;
      offset += 4;
      const opacity = splatData.getFloat32(offset + 0, true);
      const clampedOpacity = Math.max(1e-4, Math.min(0.9999, opacity));
      storage_opacity[i] = -Math.log(1 / clampedOpacity - 1);
      offset += 4;
    }
  }
  let boneIndices;
  let boneWeights;
  const weightsBuffer = chunkBuffer(header.chunks.weights);
  if (weightsBuffer) {
    const topK = Math.max(1, header.encoding?.weights?.topK ?? 4);
    const indexBytes = 2;
    const weightBytes = isFp16 ? 2 : 4;
    const weightsData = new DataView(weightsBuffer);
    boneIndices = new Uint16Array(numSplats * topK);
    boneWeights = new Float32Array(numSplats * topK);
    let wOffset = 0;
    for (let i = 0; i < numSplats; i++) {
      for (let j = 0; j < topK; j++) {
        boneIndices[i * topK + j] = weightsData.getUint16(wOffset + j * 2, true);
      }
      wOffset += topK * indexBytes;
      if (isFp16) {
        for (let j = 0; j < topK; j++) {
          boneWeights[i * topK + j] = f16ToF32(weightsData.getUint16(wOffset + j * 2, true));
        }
      } else {
        for (let j = 0; j < topK; j++) {
          boneWeights[i * topK + j] = weightsData.getFloat32(wOffset + j * 4, true);
        }
      }
      wOffset += topK * weightBytes;
    }
  }
  let animationArray;
  let animNumFrames = 0;
  let animNumBones = 0;
  if (header.animation && header.animation.numFrames > 0 && header.animation.numBones > 0) {
    const animationBuffer = chunkBuffer(header.chunks.animation);
    if (animationBuffer) {
      const FLOATS_PER_BONE = 16;
      animNumBones = header.animation.numBones;
      animNumFrames = header.animation.numFrames;
      const expectedSize = animNumFrames * animNumBones * FLOATS_PER_BONE * 4;
      if (animationBuffer.byteLength !== expectedSize) {
        const actualBoneCount = animationBuffer.byteLength / 4 / (animNumFrames * FLOATS_PER_BONE);
        if (Number.isInteger(actualBoneCount) && actualBoneCount > 0) {
          animNumBones = actualBoneCount;
        }
      }
      animationArray = new Float32Array(animationBuffer);
    }
  }
  let jointsArray;
  if (header.joints) {
    const jointsBuffer = chunkBuffer(header.chunks.joints);
    if (jointsBuffer) {
      const FLOATS_PER_JOINT = 3;
      const expectedJointsSize = header.joints.count * FLOATS_PER_JOINT * 4;
      if (jointsBuffer.byteLength === expectedJointsSize) {
        jointsArray = new Float32Array(jointsBuffer);
      }
    }
  }
  const transferables = [
    storage_x.buffer,
    storage_y.buffer,
    storage_z.buffer,
    storage_scale_0.buffer,
    storage_scale_1.buffer,
    storage_scale_2.buffer,
    storage_rot_0.buffer,
    storage_rot_1.buffer,
    storage_rot_2.buffer,
    storage_rot_3.buffer,
    storage_f_dc_0.buffer,
    storage_f_dc_1.buffer,
    storage_f_dc_2.buffer,
    storage_opacity.buffer
  ];
  if (boneIndices) transferables.push(boneIndices.buffer);
  if (boneWeights) transferables.push(boneWeights.buffer);
  if (animationArray) transferables.push(animationArray.buffer);
  if (jointsArray) transferables.push(jointsArray.buffer);
  const result = {
    header,
    numSplats,
    splats: {
      x: storage_x,
      y: storage_y,
      z: storage_z,
      scale_0: storage_scale_0,
      scale_1: storage_scale_1,
      scale_2: storage_scale_2,
      rot_0: storage_rot_0,
      rot_1: storage_rot_1,
      rot_2: storage_rot_2,
      rot_3: storage_rot_3,
      f_dc_0: storage_f_dc_0,
      f_dc_1: storage_f_dc_1,
      f_dc_2: storage_f_dc_2,
      opacity: storage_opacity
    },
    boneIndices: boneIndices ?? null,
    boneWeights: boneWeights ?? null,
    animationArray: animationArray ?? null,
    animNumFrames,
    animNumBones,
    jointsArray: jointsArray ?? null
  };
  return { result, transferables };
}

// src/loader/character/legacy/planar-splat.ts
var SH_C02 = 0.28209479177387814;
var OPACITY_CLAMP_LO = 1e-4;
var OPACITY_CLAMP_HI = 0.9999;
var MIN_SCALE = 1e-8;
var PLANAR_CONTAINERS = {
  VFCHARB2: "vfa3d-charb2",
  VSPLAT01: "vsplat-planar"
};
var FIRST_PLANAR_VERSION2 = 3;
var PLANE_CODECS = /* @__PURE__ */ new Set(["gzip", "deflate", "deflate-raw"]);
var BYTES_PER_ELEMENT = { f32: 4, f16: 2, u16: 2, u8: 1 };
var NativeFloat16Array = globalThis.Float16Array;
var _f16Buf2 = new ArrayBuffer(4);
var _f16U322 = new Uint32Array(_f16Buf2);
var _f16F322 = new Float32Array(_f16Buf2);
function f16ToF322(h) {
  const sign = (h & 32768) << 16;
  const exp = (h & 31744) >> 10;
  const frac = h & 1023;
  let bits;
  if (exp === 0) {
    if (frac === 0) {
      bits = sign;
    } else {
      let e = -14;
      let m = frac;
      while ((m & 1024) === 0) {
        m <<= 1;
        e--;
      }
      m &= 1023;
      bits = sign | e + 127 << 23 | m << 13;
    }
  } else if (exp === 31) {
    bits = sign | 2139095040 | frac << 13;
  } else {
    bits = sign | exp - 15 + 127 << 23 | frac << 13;
  }
  _f16U322[0] = bits;
  return _f16F322[0];
}
function readMagic(buffer) {
  if (buffer.byteLength < 12) return "";
  return new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
}
function isPlanarMagic(magic) {
  return Object.prototype.hasOwnProperty.call(PLANAR_CONTAINERS, magic);
}
async function inflate(src, codec) {
  const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream(codec));
  return await new Response(stream).arrayBuffer();
}
async function resolvePlanes(buffer, header, planeStart) {
  const out = {};
  for (const [name, p] of Object.entries(header.planes)) {
    const start = planeStart + p.offset;
    if (start + p.length > buffer.byteLength) {
      throw new Error(`Planar plane out of bounds: ${name}`);
    }
    const expected = p.components * p.count * BYTES_PER_ELEMENT[p.dtype];
    if (p.compression) {
      if (!PLANE_CODECS.has(p.compression)) {
        throw new Error(`Planar plane ${name}: unsupported compression ${p.compression}`);
      }
      const buf = await inflate(new Uint8Array(buffer, start, p.length), p.compression);
      if (buf.byteLength !== (p.uncompressedLength ?? expected)) {
        throw new Error(
          `Planar plane ${name}: inflated to ${buf.byteLength} B, header says ${p.uncompressedLength ?? expected} B`
        );
      }
      if (buf.byteLength !== expected) {
        throw new Error(`Planar plane ${name}: ${buf.byteLength} B, expected ${expected} B`);
      }
      out[name] = { ...p, buf, base: 0 };
    } else {
      if (p.length !== expected) {
        throw new Error(`Planar plane ${name}: ${p.length} B, expected ${expected} B`);
      }
      out[name] = { ...p, buf: buffer, base: start };
    }
  }
  return out;
}
async function parsePlanarSplats(buffer) {
  const magic = readMagic(buffer);
  const expectedFormat = PLANAR_CONTAINERS[magic];
  if (!expectedFormat) {
    throw new Error(`Invalid planar character bundle magic: ${magic}`);
  }
  const view = new DataView(buffer);
  const headerLength = view.getUint32(8, true);
  const headerStart = 12;
  const planeStart = headerStart + headerLength;
  if (planeStart > buffer.byteLength) throw new Error("Planar header length out of range");
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, headerStart, headerLength))
  );
  if (header.format !== expectedFormat) {
    throw new Error(
      `Planar bundle ${magic} declares format '${header.format}', expected '${expectedFormat}'`
    );
  }
  if (!(header.version >= FIRST_PLANAR_VERSION2)) {
    throw new Error(
      `Planar bundle ${magic} declares version ${header.version}, expected >= ${FIRST_PLANAR_VERSION2}`
    );
  }
  if (header.precision !== "fp16" && header.precision !== "q23") {
    throw new Error(`Unsupported planar precision: ${String(header.precision)}`);
  }
  if (!header.planes) throw new Error("Planar bundle has no plane table");
  if (planeStart % 4 !== 0) throw new Error("Planar plane block is not 4-byte aligned");
  const numSplats = header.numSplats;
  const topK = header.topK ?? 4;
  const isQ23 = header.precision === "q23";
  const resolved = await resolvePlanes(buffer, header, planeStart);
  const plane = (name) => {
    const p = resolved[name];
    if (!p) throw new Error(`Planar bundle missing plane: ${name}`);
    return p;
  };
  const componentOffset = (p, c) => p.base + c * p.count * BYTES_PER_ELEMENT[p.dtype];
  const readF16 = (p, c, out) => {
    const off = componentOffset(p, c);
    if (NativeFloat16Array) {
      out.set(new NativeFloat16Array(p.buf, off, p.count));
      return out;
    }
    const dv = new DataView(p.buf, off, p.count * 2);
    for (let i = 0; i < p.count; i++) out[i] = f16ToF322(dv.getUint16(i * 2, true));
    return out;
  };
  const readU8 = (p, c) => new Uint8Array(p.buf, componentOffset(p, c), p.count);
  const readU16 = (p, c) => new Uint16Array(p.buf, componentOffset(p, c), p.count);
  const readUint = (p, c) => p.dtype === "u8" ? readU8(p, c) : readU16(p, c);
  const storage_x = new Float32Array(numSplats);
  const storage_y = new Float32Array(numSplats);
  const storage_z = new Float32Array(numSplats);
  const storage_scale_0 = new Float32Array(numSplats);
  const storage_scale_1 = new Float32Array(numSplats);
  const storage_scale_2 = new Float32Array(numSplats);
  const storage_rot_0 = new Float32Array(numSplats);
  const storage_rot_1 = new Float32Array(numSplats);
  const storage_rot_2 = new Float32Array(numSplats);
  const storage_rot_3 = new Float32Array(numSplats);
  const storage_f_dc_0 = new Float32Array(numSplats);
  const storage_f_dc_1 = new Float32Array(numSplats);
  const storage_f_dc_2 = new Float32Array(numSplats);
  const storage_opacity = new Float32Array(numSplats);
  const posPlane = plane("position");
  const scalePlane = plane("scale");
  const rotPlane = plane("rotation");
  const colorPlane = plane("color");
  const opacityPlane = plane("opacity");
  const posOut = [storage_x, storage_y, storage_z];
  if (isQ23) {
    const bmin = header.bounds.min;
    const bmax = header.bounds.max;
    for (let c = 0; c < 3; c++) {
      const q = readU16(posPlane, c);
      const lo = bmin[c];
      const step = (bmax[c] - lo) / 65535;
      const out = posOut[c];
      for (let i = 0; i < numSplats; i++) out[i] = lo + q[i] * step;
    }
  } else {
    for (let c = 0; c < 3; c++) readF16(posPlane, c, posOut[c]);
  }
  const scaleOut = [storage_scale_0, storage_scale_1, storage_scale_2];
  if (isQ23) {
    const lsMin = header.logScale.min;
    const lsMax = header.logScale.max;
    for (let c = 0; c < 3; c++) {
      const q = readU8(scalePlane, c);
      const lo = lsMin[c];
      const step = (lsMax[c] - lo) / 255;
      const out = scaleOut[c];
      for (let i = 0; i < numSplats; i++) out[i] = lo + q[i] * step;
    }
  } else {
    for (let c = 0; c < 3; c++) {
      const out = readF16(scalePlane, c, scaleOut[c]);
      for (let i = 0; i < numSplats; i++) out[i] = Math.log(Math.max(out[i], MIN_SCALE));
    }
  }
  if (isQ23) {
    const qx = readU8(rotPlane, 0);
    const qy = readU8(rotPlane, 1);
    const qz = readU8(rotPlane, 2);
    for (let i = 0; i < numSplats; i++) {
      const x = qx[i] / 255 * 2 - 1;
      const y = qy[i] / 255 * 2 - 1;
      const z = qz[i] / 255 * 2 - 1;
      storage_rot_0[i] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
      storage_rot_1[i] = x;
      storage_rot_2[i] = y;
      storage_rot_3[i] = z;
    }
  } else {
    readF16(rotPlane, 0, storage_rot_1);
    readF16(rotPlane, 1, storage_rot_2);
    readF16(rotPlane, 2, storage_rot_3);
    readF16(rotPlane, 3, storage_rot_0);
  }
  const dcOut = [storage_f_dc_0, storage_f_dc_1, storage_f_dc_2];
  for (let c = 0; c < 3; c++) {
    const src = readU8(colorPlane, c);
    const out = dcOut[c];
    for (let i = 0; i < numSplats; i++) out[i] = (src[i] / 255 - 0.5) / SH_C02;
  }
  if (isQ23) {
    const lo = header.logitOpacity.min;
    const step = (header.logitOpacity.max - lo) / 255;
    const q = readU8(opacityPlane, 0);
    for (let i = 0; i < numSplats; i++) storage_opacity[i] = lo + q[i] * step;
  } else {
    readF16(opacityPlane, 0, storage_opacity);
    for (let i = 0; i < numSplats; i++) {
      const a = Math.max(OPACITY_CLAMP_LO, Math.min(OPACITY_CLAMP_HI, storage_opacity[i]));
      storage_opacity[i] = -Math.log(1 / a - 1);
    }
  }
  let boneIndices;
  let boneWeights;
  if (header.planes.boneIndex && header.planes.boneWeight) {
    const idxPlane = plane("boneIndex");
    const wPlane = plane("boneWeight");
    boneIndices = new Uint16Array(numSplats * topK);
    boneWeights = new Float32Array(numSplats * topK);
    const palette = header.bonePalette;
    for (let j = 0; j < topK; j++) {
      const src = readUint(idxPlane, j);
      if (palette) {
        for (let i = 0; i < numSplats; i++) boneIndices[i * topK + j] = palette[src[i]];
      } else {
        for (let i = 0; i < numSplats; i++) boneIndices[i * topK + j] = src[i];
      }
    }
    if (isQ23) {
      const scratch = new Float32Array(numSplats);
      for (let j = 0; j < wPlane.components; j++) {
        const src = readU8(wPlane, j);
        for (let i = 0; i < numSplats; i++) {
          const w = src[i] / 255;
          boneWeights[i * topK + j] = w;
          scratch[i] += w;
        }
      }
      for (let i = 0; i < numSplats; i++) {
        boneWeights[i * topK + (topK - 1)] = Math.max(0, 1 - scratch[i]);
      }
    } else {
      const col = new Float32Array(numSplats);
      for (let j = 0; j < topK; j++) {
        readF16(wPlane, j, col);
        for (let i = 0; i < numSplats; i++) boneWeights[i * topK + j] = col[i];
      }
    }
  }
  let jointsArray;
  if (header.planes.joints) {
    const jp = plane("joints");
    jointsArray = new Float32Array(jp.count * 3);
    for (let c = 0; c < 3; c++) {
      const src = new Float32Array(jp.buf, componentOffset(jp, c), jp.count);
      for (let i = 0; i < jp.count; i++) jointsArray[i * 3 + c] = src[i];
    }
  }
  const transferables = [
    storage_x.buffer,
    storage_y.buffer,
    storage_z.buffer,
    storage_scale_0.buffer,
    storage_scale_1.buffer,
    storage_scale_2.buffer,
    storage_rot_0.buffer,
    storage_rot_1.buffer,
    storage_rot_2.buffer,
    storage_rot_3.buffer,
    storage_f_dc_0.buffer,
    storage_f_dc_1.buffer,
    storage_f_dc_2.buffer,
    storage_opacity.buffer
  ];
  if (boneIndices) transferables.push(boneIndices.buffer);
  if (boneWeights) transferables.push(boneWeights.buffer);
  if (jointsArray) transferables.push(jointsArray.buffer);
  const result = {
    header,
    numSplats,
    splats: {
      x: storage_x,
      y: storage_y,
      z: storage_z,
      scale_0: storage_scale_0,
      scale_1: storage_scale_1,
      scale_2: storage_scale_2,
      rot_0: storage_rot_0,
      rot_1: storage_rot_1,
      rot_2: storage_rot_2,
      rot_3: storage_rot_3,
      f_dc_0: storage_f_dc_0,
      f_dc_1: storage_f_dc_1,
      f_dc_2: storage_f_dc_2,
      opacity: storage_opacity
    },
    boneIndices: boneIndices ?? null,
    boneWeights: boneWeights ?? null,
    // Planar files carry no animation chunk; the fields exist so both
    // containers hand `loadBinaryGsplat` the same shape.
    animationArray: null,
    animNumFrames: 0,
    animNumBones: 0,
    jointsArray: jointsArray ?? null,
    nativeFloat16: !!NativeFloat16Array,
    planeCompression: header.encoding?.planeCompression ?? null
  };
  return { result, transferables };
}

// src/loader/character/legacy/index.ts
function hasCorrectionReceipt(header) {
  const h = header;
  return h?.corrections != null || h?.ankleCorrection != null;
}
function legacyRigBoneCount(header, animNumFrames, animNumBones) {
  const h = header;
  if (!h?.joints && !h?.skeleton) return 0;
  let numBones = animNumFrames > 0 && animNumBones > 0 ? animNumBones : 0;
  if (numBones === 0 && h.skeleton) numBones = h.skeleton.count;
  if (numBones === 0 && h.joints) numBones = h.joints.count;
  return numBones > 0 ? numBones : 0;
}
async function decodeLegacyBundle(file) {
  if (file.byteLength < 12) {
    throw new CharacterBundleError(
      "WrongMagic",
      `character bundle is ${file.byteLength} B, too small to carry a magic`
    );
  }
  const magic = readMagic(file);
  let decoded;
  if (isPlanarMagic(magic)) {
    decoded = await parsePlanarSplats(file);
  } else if (magic === CHARACTER_BUNDLE_MAGIC) {
    decoded = parseBinaryGsplat(file);
  } else {
    throw new CharacterBundleError(
      "WrongMagic",
      `unrecognised character bundle magic '${magic}'`
    );
  }
  const { result, transferables } = decoded;
  const bundle = {
    ...result,
    rigBoneCount: legacyRigBoneCount(result.header, result.animNumFrames, result.animNumBones),
    corrected: hasCorrectionReceipt(result.header),
    // Never. A legacy joints block is diagnostics: it was not vetted as a
    // posing rest, and every shipped legacy character renders against the
    // canonical tables. Independent of the receipt above on purpose.
    bundledRestIsPerCharacter: false
  };
  return { result: bundle, transferables };
}

// src/loader/character/v1/decode.ts
var SH_C03 = 0.28209479177387814;
var POSITION_LEVELS = 65536;
var BYTE_LEVELS = 256;
var BYTES_PER_ELEMENT2 = { f32: 4, u16: 2, u8: 1 };
var COMMON_KEYS = ["offset", "length", "dtype", "components", "count"];
var BLOCK_SHAPES = {
  position: { dtypes: ["u16"], components: 3 },
  scale: { dtypes: ["u8"], components: 3 },
  rotation: { dtypes: ["u8"], components: 3 },
  color: { dtypes: ["u8"], components: 3 },
  opacity: { dtypes: ["u8"], components: 1 },
  boneIndex: { dtypes: ["u8", "u16"], components: null },
  boneWeight: { dtypes: ["u8"], components: null },
  joints: { dtypes: ["f32"], components: 3 }
};
var UNCONDITIONAL_BLOCKS = ["position", "scale", "rotation", "color", "opacity"];
var BOUNDED_BLOCKS = ["position", "scale", "opacity"];
function fail(category, message) {
  throw new CharacterBundleError(category, message);
}
var isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isUint = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
function validateCommonKeys(name, entry, blockStart, totalLength) {
  if (!isPlainObject(entry)) {
    fail("BadFieldValue", `block '${name}': entry is ${JSON.stringify(entry)}, expected an object`);
  }
  const e = entry;
  for (const key of COMMON_KEYS) {
    if (e[key] === void 0 || e[key] === null) {
      fail("MissingField", `block '${name}': missing required key '${key}'`);
    }
  }
  for (const key of ["offset", "length", "components", "count"]) {
    if (!isUint(e[key])) {
      fail("BadFieldValue", `block '${name}': '${key}' is ${JSON.stringify(e[key])}, expected a non-negative integer`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(BYTES_PER_ELEMENT2, e.dtype)) {
    fail(
      "BadFieldValue",
      `block '${name}': dtype ${JSON.stringify(e.dtype)}, expected one of ${Object.keys(BYTES_PER_ELEMENT2).join(", ")}`
    );
  }
  const p = e;
  if (p.offset % 4 !== 0) {
    fail("UnalignedPayload", `block '${name}': offset ${p.offset} is not a multiple of 4`);
  }
  const end = blockStart + p.offset + p.length;
  if (end > totalLength) {
    fail(
      "Truncated",
      `block '${name}': bytes [${blockStart + p.offset}, ${end}) run past the file's ${totalLength} B`
    );
  }
  const decoded = p.components * p.count * BYTES_PER_ELEMENT2[p.dtype];
  if (p.length !== decoded) {
    fail(
      "BlockSizeMismatch",
      `block '${name}': length ${p.length} B, but ${p.components} components x ${p.count} rows x ${BYTES_PER_ELEMENT2[p.dtype]} B (${p.dtype}) = ${decoded} B`
    );
  }
}
function validateManifest(header, blocks) {
  for (const name of UNCONDITIONAL_BLOCKS) {
    if (!blocks[name]) fail("MissingField", `manifest is missing the required block '${name}'`);
  }
  for (const [name, p] of Object.entries(blocks)) {
    const shape = BLOCK_SHAPES[name];
    if (!shape) continue;
    if (!shape.dtypes.includes(p.dtype)) {
      fail(
        "InconsistentHeader",
        `block '${name}': dtype '${p.dtype}', expected ${shape.dtypes.map((d) => `'${d}'`).join(" or ")}`
      );
    }
    if (shape.components !== null && p.components !== shape.components) {
      fail(
        "InconsistentHeader",
        `block '${name}': ${p.components} components, expected exactly ${shape.components}`
      );
    }
    if (name !== "joints" && p.count !== header.numSplats) {
      fail(
        "InconsistentHeader",
        `block '${name}': count ${p.count}, expected numSplats ${header.numSplats}`
      );
    }
  }
  if (blocks.joints && blocks.joints.count === 0) {
    fail("UnexpectedField", `block 'joints': count 0, and an empty rig is not a rig`);
  }
  for (const [name, p] of Object.entries(blocks)) {
    if (!BLOCK_SHAPES[name]) continue;
    const bounded = BOUNDED_BLOCKS.includes(name);
    for (const key of ["min", "max"]) {
      const v = p[key];
      if (!bounded) {
        if (v !== void 0) {
          fail("UnexpectedField", `block '${name}': carries '${key}', but its range is fixed by its type`);
        }
        continue;
      }
      if (v === void 0) {
        fail("MissingField", `block '${name}': missing dequantisation bound '${key}'`);
      }
      if (!Array.isArray(v) || v.length !== p.components || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
        fail(
          "BadFieldValue",
          `block '${name}': '${key}' is ${JSON.stringify(v)}, expected an array of ${p.components} finite numbers`
        );
      }
    }
    if (bounded) {
      for (let c = 0; c < p.components; c++) {
        if (p.max[c] < p.min[c]) {
          fail(
            "BadFieldValue",
            `block '${name}': component ${c} has max ${p.max[c]} below min ${p.min[c]}, an inverted span`
          );
        }
      }
    }
    if (name !== "boneIndex" && p.palette !== void 0) {
      fail("UnexpectedField", `block '${name}': carries a 'palette', which only 'boneIndex' takes`);
    }
  }
  const hasIndex = !!blocks.boneIndex;
  const hasWeight = !!blocks.boneWeight;
  if (hasIndex && !hasWeight) {
    fail("MissingField", `manifest has 'boneIndex' but not 'boneWeight'; skinning needs both`);
  }
  if (hasWeight && !hasIndex) {
    fail("UnexpectedField", `manifest has 'boneWeight' but not 'boneIndex'; skinning needs both`);
  }
  if (hasIndex) {
    const idx = blocks.boneIndex;
    const w = blocks.boneWeight;
    if (w.components !== idx.components - 1) {
      fail(
        "InconsistentHeader",
        `block 'boneWeight': ${w.components} components, expected boneIndex.components - 1 = ${idx.components - 1}`
      );
    }
    if (idx.palette === void 0) {
      fail("MissingField", `block 'boneIndex': missing 'palette'`);
    }
    if (!Array.isArray(idx.palette) || !idx.palette.every(isUint)) {
      fail(
        "BadFieldValue",
        `block 'boneIndex': 'palette' is ${JSON.stringify(idx.palette)?.slice(0, 80)}, expected an array of rig indices`
      );
    }
    const rigBones = blocks.joints?.count;
    if (rigBones !== void 0) {
      for (let i = 0; i < idx.palette.length; i++) {
        if (idx.palette[i] >= rigBones) {
          fail(
            "InconsistentHeader",
            `block 'boneIndex': palette[${i}] is ${idx.palette[i]}, outside the ${rigBones}-bone rig`
          );
        }
      }
    }
  }
}
function resolveBlocks(blocks, blockStart) {
  const out = {};
  for (const [name, p] of Object.entries(blocks)) {
    if (!BLOCK_SHAPES[name]) continue;
    out[name] = { ...p, base: blockStart + p.offset };
  }
  return out;
}
async function decodeV1(file, payloadOffset, payloadLength) {
  const totalLength = payloadOffset + payloadLength;
  if (payloadLength < 4) {
    fail("Truncated", `payload is ${payloadLength} B, too small to carry a header length`);
  }
  const headerLength = new DataView(file).getUint32(payloadOffset, true);
  const headerStart = payloadOffset + 4;
  const blockStart = headerStart + headerLength;
  if (blockStart > totalLength) {
    fail(
      "Truncated",
      `header claims ${headerLength} B, which ends at ${blockStart}, past the file's ${totalLength} B`
    );
  }
  if (headerLength % 4 !== 0) {
    fail("UnalignedPayload", `headerLength ${headerLength} is not a multiple of 4`);
  }
  let header;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(file, headerStart, headerLength)
    );
    header = JSON.parse(text);
  } catch (err) {
    return fail("MalformedHeader", `header is not valid UTF-8 JSON (${err?.message ?? String(err)})`);
  }
  if (!isPlainObject(header)) {
    return fail("MalformedHeader", `header is ${JSON.stringify(header)}, expected a JSON object`);
  }
  if (header.numSplats === void 0 || header.numSplats === null) {
    fail("MissingField", `header is missing 'numSplats'`);
  }
  if (!isUint(header.numSplats)) {
    fail("BadFieldValue", `header 'numSplats' is ${JSON.stringify(header.numSplats)}, expected a non-negative integer`);
  }
  if (header.blocks === void 0 || header.blocks === null) {
    fail("MissingField", `header is missing 'blocks', the block table`);
  }
  if (!isPlainObject(header.blocks)) {
    fail("BadFieldValue", `header 'blocks' is ${JSON.stringify(header.blocks)}, expected an object`);
  }
  const numSplats = header.numSplats;
  const blocks = {};
  for (const [name, entry] of Object.entries(header.blocks)) {
    if (!BLOCK_SHAPES[name]) continue;
    validateCommonKeys(name, entry, blockStart, totalLength);
    blocks[name] = entry;
  }
  validateManifest(header, blocks);
  const resolved = resolveBlocks(blocks, blockStart);
  const block = (name) => resolved[name];
  const componentOffset = (p, c) => p.base + c * p.count * BYTES_PER_ELEMENT2[p.dtype];
  const readU8 = (p, c) => new Uint8Array(file, componentOffset(p, c), p.count);
  const readU16 = (p, c) => new Uint16Array(file, componentOffset(p, c), p.count);
  const readUint = (p, c) => p.dtype === "u8" ? readU8(p, c) : readU16(p, c);
  const storage_x = new Float32Array(numSplats);
  const storage_y = new Float32Array(numSplats);
  const storage_z = new Float32Array(numSplats);
  const storage_scale_0 = new Float32Array(numSplats);
  const storage_scale_1 = new Float32Array(numSplats);
  const storage_scale_2 = new Float32Array(numSplats);
  const storage_rot_0 = new Float32Array(numSplats);
  const storage_rot_1 = new Float32Array(numSplats);
  const storage_rot_2 = new Float32Array(numSplats);
  const storage_rot_3 = new Float32Array(numSplats);
  const storage_f_dc_0 = new Float32Array(numSplats);
  const storage_f_dc_1 = new Float32Array(numSplats);
  const storage_f_dc_2 = new Float32Array(numSplats);
  const storage_opacity = new Float32Array(numSplats);
  const dequantise = (p, levels, out) => {
    for (let c = 0; c < out.length; c++) {
      const q = levels === POSITION_LEVELS ? readU16(p, c) : readU8(p, c);
      const lo = p.min[c];
      const step = (p.max[c] - lo) / (levels - 1);
      const dst = out[c];
      for (let i = 0; i < numSplats; i++) dst[i] = lo + q[i] * step;
    }
  };
  dequantise(block("position"), POSITION_LEVELS, [storage_x, storage_y, storage_z]);
  dequantise(block("scale"), BYTE_LEVELS, [storage_scale_0, storage_scale_1, storage_scale_2]);
  dequantise(block("opacity"), BYTE_LEVELS, [storage_opacity]);
  {
    const p = block("rotation");
    const qx = readU8(p, 0);
    const qy = readU8(p, 1);
    const qz = readU8(p, 2);
    for (let i = 0; i < numSplats; i++) {
      const x = qx[i] / 255 * 2 - 1;
      const y = qy[i] / 255 * 2 - 1;
      const z = qz[i] / 255 * 2 - 1;
      storage_rot_0[i] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
      storage_rot_1[i] = x;
      storage_rot_2[i] = y;
      storage_rot_3[i] = z;
    }
  }
  {
    const p = block("color");
    const dcOut = [storage_f_dc_0, storage_f_dc_1, storage_f_dc_2];
    for (let c = 0; c < 3; c++) {
      const src = readU8(p, c);
      const dst = dcOut[c];
      for (let i = 0; i < numSplats; i++) dst[i] = (src[i] / 255 - 0.5) / SH_C03;
    }
  }
  let boneIndices;
  let boneWeights;
  if (resolved.boneIndex) {
    const idxBlock = block("boneIndex");
    const wBlock = block("boneWeight");
    const palette = idxBlock.palette;
    const K = idxBlock.components;
    boneIndices = new Uint16Array(numSplats * K);
    boneWeights = new Float32Array(numSplats * K);
    for (let j = 0; j < K; j++) {
      const src = readUint(idxBlock, j);
      for (let i = 0; i < numSplats; i++) {
        const q = src[i];
        if (q >= palette.length) {
          fail(
            "InconsistentHeader",
            `block 'boneIndex': gaussian ${i} slot ${j} stores index ${q}, outside its ${palette.length}-entry palette`
          );
        }
        boneIndices[i * K + j] = palette[q];
      }
    }
    const stored = new Uint32Array(numSplats);
    for (let j = 0; j < wBlock.components; j++) {
      const src = readU8(wBlock, j);
      for (let i = 0; i < numSplats; i++) {
        boneWeights[i * K + j] = src[i] / 255;
        stored[i] += src[i];
      }
    }
    for (let i = 0; i < numSplats; i++) {
      boneWeights[i * K + (K - 1)] = Math.max(0, 255 - stored[i]) / 255;
    }
  }
  let jointsArray;
  let rigBoneCount = 0;
  if (resolved.joints) {
    const p = block("joints");
    rigBoneCount = p.count;
    jointsArray = new Float32Array(p.count * 3);
    for (let c = 0; c < 3; c++) {
      const src = new Float32Array(file, componentOffset(p, c), p.count);
      for (let i = 0; i < p.count; i++) jointsArray[i * 3 + c] = src[i];
    }
  }
  const transferables = [
    storage_x.buffer,
    storage_y.buffer,
    storage_z.buffer,
    storage_scale_0.buffer,
    storage_scale_1.buffer,
    storage_scale_2.buffer,
    storage_rot_0.buffer,
    storage_rot_1.buffer,
    storage_rot_2.buffer,
    storage_rot_3.buffer,
    storage_f_dc_0.buffer,
    storage_f_dc_1.buffer,
    storage_f_dc_2.buffer,
    storage_opacity.buffer
  ];
  if (boneIndices) transferables.push(boneIndices.buffer);
  if (boneWeights) transferables.push(boneWeights.buffer);
  if (jointsArray) transferables.push(jointsArray.buffer);
  const result = {
    header,
    numSplats,
    splats: {
      x: storage_x,
      y: storage_y,
      z: storage_z,
      scale_0: storage_scale_0,
      scale_1: storage_scale_1,
      scale_2: storage_scale_2,
      rot_0: storage_rot_0,
      rot_1: storage_rot_1,
      rot_2: storage_rot_2,
      rot_3: storage_rot_3,
      f_dc_0: storage_f_dc_0,
      f_dc_1: storage_f_dc_1,
      f_dc_2: storage_f_dc_2,
      opacity: storage_opacity
    },
    boneIndices: boneIndices ?? null,
    boneWeights: boneWeights ?? null,
    // This format carries no animation. Clips are separate files, registered
    // separately; the fields exist so every version hands back one shape.
    animationArray: null,
    animNumFrames: 0,
    animNumBones: 0,
    jointsArray: jointsArray ?? null,
    rigBoneCount,
    // Version 1 means corrected. There is no field to read and no receipt to
    // find, and a reader is forbidden from looking for one.
    corrected: true,
    // Always. The corrections are baked into the gaussians AND into the joints
    // block, so this rest is the character's own and the two agree.
    bundledRestIsPerCharacter: true
  };
  return { result, transferables };
}

// src/loader/character/index.ts
var VIGGCHAR_MAGIC = new Uint8Array([86, 73, 71, 71, 67, 72, 65, 82]);
var CONTAINER_BYTES = 16;
var VERSION_HANDLERS = /* @__PURE__ */ new Map([
  [1, decodeV1]
]);
function hasViggcharMagic(file) {
  if (file.byteLength < VIGGCHAR_MAGIC.length) return false;
  const bytes = new Uint8Array(file, 0, VIGGCHAR_MAGIC.length);
  for (let i = 0; i < VIGGCHAR_MAGIC.length; i++) {
    if (bytes[i] !== VIGGCHAR_MAGIC[i]) return false;
  }
  return true;
}
async function parseCharacterBundle(file) {
  if (!hasViggcharMagic(file)) {
    return await decodeLegacyBundle(file);
  }
  if (file.byteLength < CONTAINER_BYTES) {
    throw new CharacterBundleError(
      "Truncated",
      `file is ${file.byteLength} B, shorter than the ${CONTAINER_BYTES} B container`
    );
  }
  const view = new DataView(file);
  const version = view.getUint32(8, true);
  const handler = VERSION_HANDLERS.get(version);
  if (!handler) {
    throw new CharacterBundleError(
      "UnknownVersion",
      `file declares version ${version}; this reader implements ${[...VERSION_HANDLERS.keys()].sort((a, b) => a - b).join(", ")}`
    );
  }
  const totalLength = view.getUint32(12, true);
  if (totalLength < CONTAINER_BYTES) {
    throw new CharacterBundleError(
      "Truncated",
      `header declares totalLength ${totalLength} B, below the ${CONTAINER_BYTES} B container`
    );
  }
  if (file.byteLength < totalLength) {
    throw new CharacterBundleError(
      "Truncated",
      `header declares totalLength ${totalLength} B, but the file is ${file.byteLength} B`
    );
  }
  return await handler(file, CONTAINER_BYTES, totalLength - CONTAINER_BYTES);
}

// src/loader/character/binary-gsplat-worker.ts
self.onmessage = (e) => {
  const { id, buffer } = e.data;
  parseCharacterBundle(buffer).then(({ result, transferables }) => {
    self.postMessage({ id, ok: true, ...result }, transferables);
  }).catch((err) => {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      category: err instanceof CharacterBundleError ? err.category : void 0
    });
  });
};
//# sourceMappingURL=binary-gsplat-worker.js.map
