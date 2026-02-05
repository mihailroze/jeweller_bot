const WAX_DENSITY = 0.8;
const UNIT_SCALE = {
  mm: 0.001,
  cm: 1,
};

const elements = {
  dropZone: document.getElementById("drop-zone"),
  fileInput: document.getElementById("file-input"),
  fileButton: document.getElementById("file-button"),
  units: document.getElementById("units"),
  fileName: document.getElementById("file-name"),
  fileList: document.getElementById("file-list"),
  fileCount: document.getElementById("file-count"),
  volume: document.getElementById("volume"),
  weight: document.getElementById("weight"),
  volumeTotal: document.getElementById("volume-total"),
  weightTotal: document.getElementById("weight-total"),
  status: document.getElementById("status"),
  capture: document.getElementById("capture"),
  download: document.getElementById("download"),
  shareWeb: document.getElementById("share-web"),
  shareTg: document.getElementById("share-tg"),
  snapshot: document.getElementById("snapshot"),
  empty: document.getElementById("empty"),
  canvas: document.getElementById("viewer"),
  error: document.getElementById("error"),
  tgTotal: document.getElementById("tg-total"),
  tgUnique: document.getElementById("tg-unique"),
  tgRepeat: document.getElementById("tg-repeat"),
  webTotal: document.getElementById("web-total"),
  webUnique: document.getElementById("web-unique"),
  webRepeat: document.getElementById("web-repeat"),
  metalDate: document.getElementById("metal-date"),
  metalAu: document.getElementById("metal-au"),
  metalAg: document.getElementById("metal-ag"),
  metalPt: document.getElementById("metal-pt"),
  metalPd: document.getElementById("metal-pd"),
  pickFileMobile: document.getElementById("pick-file-mobile"),
  resetView: document.getElementById("reset-view"),
  rotateLeft: document.getElementById("rotate-left"),
  rotateRight: document.getElementById("rotate-right"),
  rotateUp: document.getElementById("rotate-up"),
  rotateDown: document.getElementById("rotate-down"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
};

window.__APP_READY__ = true;

const state = {
  gl: null,
  program: null,
  attribs: {},
  uniforms: {},
  buffers: {
    position: null,
    normal: null,
  },
  vertexCount: 0,
  rawVolume: 0,
  files: [],
  currentIndex: -1,
  loadId: 0,
  selectToken: 0,
  scale: 1,
  rotation: { yaw: 0.6, pitch: -0.4 },
  dragging: false,
  lastPointer: { x: 0, y: 0 },
  renderFrames: 0,
  renderLoopActive: false,
  autoSpinFrames: 0,
  zoom: 1,
  pinch: { active: false, distance: 0 },
  snapshotUrl: null,
  snapshotDataUrl: null,
};

const CLIENT_ID_KEY = "tf_client_id";

function setStatus(message) {
  elements.status.textContent = message;
}

function setError(message) {
  if (elements.error) elements.error.textContent = message || "";
}

function setMetrics(currentVolumeCm3, totalVolumeCm3) {
  const currentWeight = currentVolumeCm3 * WAX_DENSITY;
  const totalWeight = totalVolumeCm3 * WAX_DENSITY;
  elements.volume.textContent = currentVolumeCm3.toFixed(2);
  elements.weight.textContent = currentWeight.toFixed(2);
  if (elements.volumeTotal) {
    elements.volumeTotal.textContent = totalVolumeCm3.toFixed(2);
  }
  if (elements.weightTotal) {
    elements.weightTotal.textContent = totalWeight.toFixed(2);
  }
}

function getUnitScale() {
  return UNIT_SCALE[elements.units.value] || 1;
}

function volumeToCm3(rawVolume) {
  return rawVolume * getUnitScale();
}

function getTotalRawVolume() {
  return state.files.reduce((sum, entry) => sum + (entry.rawVolume || 0), 0);
}

function isBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  const expected = 84 + triCount * 50;
  return expected === buffer.byteLength;
}

function parseBinarySTL(buffer) {
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let offset = 84;
  let p = 0;
  let n = 0;
  let volume = 0;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < triCount; i++) {
    offset += 12; // skip stored normal

    const ax = dv.getFloat32(offset, true);
    offset += 4;
    const ay = dv.getFloat32(offset, true);
    offset += 4;
    const az = dv.getFloat32(offset, true);
    offset += 4;
    const bx = dv.getFloat32(offset, true);
    offset += 4;
    const by = dv.getFloat32(offset, true);
    offset += 4;
    const bz = dv.getFloat32(offset, true);
    offset += 4;
    const cx = dv.getFloat32(offset, true);
    offset += 4;
    const cy = dv.getFloat32(offset, true);
    offset += 4;
    const cz = dv.getFloat32(offset, true);
    offset += 4;
    offset += 2;

    positions[p++] = ax;
    positions[p++] = ay;
    positions[p++] = az;
    positions[p++] = bx;
    positions[p++] = by;
    positions[p++] = bz;
    positions[p++] = cx;
    positions[p++] = cy;
    positions[p++] = cz;

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    for (let j = 0; j < 3; j++) {
      normals[n++] = nx;
      normals[n++] = ny;
      normals[n++] = nz;
    }

    minX = Math.min(minX, ax, bx, cx);
    minY = Math.min(minY, ay, by, cy);
    minZ = Math.min(minZ, az, bz, cz);
    maxX = Math.max(maxX, ax, bx, cx);
    maxY = Math.max(maxY, ay, by, cy);
    maxZ = Math.max(maxZ, az, bz, cz);

    volume +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }

  return {
    positions,
    normals,
    volume: Math.abs(volume / 6),
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
  };
}

function parseAsciiSTL(buffer) {
  const text = new TextDecoder().decode(buffer);
  const regex = /vertex\s+([0-9eE+.\-]+)\s+([0-9eE+.\-]+)\s+([0-9eE+.\-]+)/g;
  const positions = [];
  const normals = [];
  let verts = [];
  let volume = 0;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const z = parseFloat(match[3]);
    verts.push(x, y, z);

    if (verts.length === 9) {
      const ax = verts[0];
      const ay = verts[1];
      const az = verts[2];
      const bx = verts[3];
      const by = verts[4];
      const bz = verts[5];
      const cx = verts[6];
      const cy = verts[7];
      const cz = verts[8];

      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);

      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = cy - ay;
      const acz = cz - az;
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      for (let i = 0; i < 3; i++) {
        normals.push(nx, ny, nz);
      }

      minX = Math.min(minX, ax, bx, cx);
      minY = Math.min(minY, ay, by, cy);
      minZ = Math.min(minZ, az, bz, cz);
      maxX = Math.max(maxX, ax, bx, cx);
      maxY = Math.max(maxY, ay, by, cy);
      maxZ = Math.max(maxZ, az, bz, cz);

      volume +=
        ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx);

      verts = [];
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    volume: Math.abs(volume / 6),
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
  };
}

function parseBinarySTLVolume(buffer) {
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  let offset = 84;
  let volume = 0;

  for (let i = 0; i < triCount; i++) {
    offset += 12;
    const ax = dv.getFloat32(offset, true);
    offset += 4;
    const ay = dv.getFloat32(offset, true);
    offset += 4;
    const az = dv.getFloat32(offset, true);
    offset += 4;
    const bx = dv.getFloat32(offset, true);
    offset += 4;
    const by = dv.getFloat32(offset, true);
    offset += 4;
    const bz = dv.getFloat32(offset, true);
    offset += 4;
    const cx = dv.getFloat32(offset, true);
    offset += 4;
    const cy = dv.getFloat32(offset, true);
    offset += 4;
    const cz = dv.getFloat32(offset, true);
    offset += 4;
    offset += 2;

    volume +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }

  return Math.abs(volume / 6);
}

function parseAsciiSTLVolume(buffer) {
  const text = new TextDecoder().decode(buffer);
  const regex = /vertex\s+([0-9eE+.\-]+)\s+([0-9eE+.\-]+)\s+([0-9eE+.\-]+)/g;
  let verts = [];
  let volume = 0;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const z = parseFloat(match[3]);
    verts.push(x, y, z);

    if (verts.length === 9) {
      const ax = verts[0];
      const ay = verts[1];
      const az = verts[2];
      const bx = verts[3];
      const by = verts[4];
      const bz = verts[5];
      const cx = verts[6];
      const cy = verts[7];
      const cz = verts[8];

      volume +=
        ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx);

      verts = [];
    }
  }

  return Math.abs(volume / 6);
}

function centerGeometry(positions, bounds) {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeY = bounds.maxY - bounds.minY;
  const sizeZ = bounds.maxZ - bounds.minZ;
  const maxDim = Math.max(sizeX, sizeY, sizeZ) || 1;

  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= centerX;
    positions[i + 1] -= centerY;
    positions[i + 2] -= centerZ;
  }

  return maxDim;
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function mat4LookAt(eye, center, up) {
  const [ex, ey, ez] = eye;
  const [cx, cy, cz] = center;

  let zx = ex - cx;
  let zy = ey - cy;
  let zz = ez - cz;
  let len = Math.hypot(zx, zy, zz);
  if (len === 0) {
    zz = 1;
  } else {
    zx /= len;
    zy /= len;
    zz /= len;
  }

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  if (len === 0) {
    xx = 1;
  } else {
    xx /= len;
    xy /= len;
    xz /= len;
  }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const out = mat4Identity();
  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}

function buildModelMatrix(yaw, pitch, scale) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);

  return new Float32Array([
    cy * scale,
    0,
    -sy * scale,
    0,
    sy * sx * scale,
    cx * scale,
    cy * sx * scale,
    0,
    sy * cx * scale,
    -sx * scale,
    cy * cx * scale,
    0,
    0,
    0,
    0,
    1,
  ]);
}

function buildNormalMatrix(yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);

  return new Float32Array([
    cy,
    0,
    -sy,
    sy * sx,
    cx,
    cy * sx,
    sy * cx,
    -sx,
    cy * cx,
  ]);
}

function resizeCanvas() {
  const gl = state.gl;
  if (!gl) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const rawWidth = elements.canvas.clientWidth || 300;
  const rawHeight = elements.canvas.clientHeight || 300;
  const width = Math.max(1, Math.floor(rawWidth * dpr));
  const height = Math.max(1, Math.floor(rawHeight * dpr));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
}

function render() {
  const gl = state.gl;
  if (!gl || !state.program || state.vertexCount === 0) return;

  resizeCanvas();

  if (!state.dragging && state.autoSpinFrames > 0) {
    state.rotation.yaw += 0.006;
    state.autoSpinFrames -= 1;
  }

  const aspect = elements.canvas.width / elements.canvas.height;
  const projection = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);
  const distance = 3 / state.zoom;
  const view = mat4LookAt([0, 0, distance], [0, 0, 0], [0, 1, 0]);
  const model = buildModelMatrix(
    state.rotation.yaw,
    state.rotation.pitch,
    state.scale
  );
  const mvp = mat4Multiply(projection, mat4Multiply(view, model));
  const normal = buildNormalMatrix(state.rotation.yaw, state.rotation.pitch);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(state.program);

  gl.uniformMatrix4fv(state.uniforms.mvp, false, mvp);
  gl.uniformMatrix3fv(state.uniforms.normal, false, normal);
  gl.uniform3f(state.uniforms.color, 0.8, 0.62, 0.42);

  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.position);
  gl.enableVertexAttribArray(state.attribs.position);
  gl.vertexAttribPointer(state.attribs.position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.normal);
  gl.enableVertexAttribArray(state.attribs.normal);
  gl.vertexAttribPointer(state.attribs.normal, 3, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLES, 0, state.vertexCount);
}

function uploadGeometry(positions, normals, maxDim) {
  const gl = state.gl;
  if (!gl) return;

  if (!state.buffers.position) {
    state.buffers.position = gl.createBuffer();
    state.buffers.normal = gl.createBuffer();
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.position);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.normal);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

  state.vertexCount = positions.length / 3;
  state.scale = 0.9 / maxDim;
  scheduleRender(60);
}

function updateMetrics() {
  const currentEntry = state.files[state.currentIndex];
  const currentRaw = currentEntry ? currentEntry.rawVolume || 0 : state.rawVolume;
  const currentVolumeCm3 = volumeToCm3(currentRaw);
  const totalVolumeCm3 = volumeToCm3(getTotalRawVolume());
  setMetrics(currentVolumeCm3, totalVolumeCm3);
}

function setDailyCounters(payload) {
  if (!elements.tgTotal && !elements.webTotal) return;
  const platforms = payload?.platforms || {};
  const tg = platforms.tg || payload?.tg || {};
  const web = platforms.web || payload?.web || {};

  const format = (value) =>
    typeof value === "number" && Number.isFinite(value) ? String(value) : "—";

  if (elements.tgTotal) elements.tgTotal.textContent = format(tg.total);
  if (elements.tgUnique) elements.tgUnique.textContent = format(tg.unique);
  if (elements.tgRepeat) elements.tgRepeat.textContent = format(tg.repeats);

  if (elements.webTotal) elements.webTotal.textContent = format(web.total);
  if (elements.webUnique) elements.webUnique.textContent = format(web.unique);
  if (elements.webRepeat) elements.webRepeat.textContent = format(web.repeats);
}

function handleParsed(parsed, options = {}) {
  if (!parsed.positions.length) {
    setError("Файл не содержит треугольников.");
    return;
  }

  const maxDim = centerGeometry(parsed.positions, parsed.bounds);
  state.rawVolume = parsed.volume;
  updateMetrics();
  uploadGeometry(parsed.positions, parsed.normals, maxDim);
  elements.empty.style.display = "none";
  setStatus(
    options.statusMessage ||
      "Готово. Можно вращать модель и делать скриншот."
  );
  state.autoSpinFrames = options.autoSpin === false ? 0 : 120;
  if (options.capture !== false) {
    setTimeout(captureSnapshot, 120);
  }
}

function resetBatch() {
  state.files = [];
  state.currentIndex = -1;
  state.rawVolume = 0;
  updateMetrics();
  updateFileList();
  elements.fileName.textContent = "—";
  elements.empty.style.display = "grid";
  elements.snapshot.removeAttribute("src");
  if (state.snapshotUrl) {
    URL.revokeObjectURL(state.snapshotUrl);
    state.snapshotUrl = null;
  }
  state.snapshotDataUrl = null;
  elements.download.removeAttribute("href");
  scheduleRender(2);
}

function updateFileName(entry, index) {
  if (!entry) {
    elements.fileName.textContent = "—";
    return;
  }
  const total = state.files.length;
  const prefix = total > 1 ? `${index + 1}/${total} - ` : "";
  elements.fileName.textContent = `${prefix}${entry.name}`;
}

function updateFileList() {
  if (!elements.fileList) return;
  elements.fileList.innerHTML = "";
  const scale = getUnitScale();

  state.files.forEach((entry, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `file-item${index === state.currentIndex ? " active" : ""}`;
    item.addEventListener("click", () => selectFile(index));

    const name = document.createElement("div");
    name.className = "file-item-name";
    name.textContent = entry.name;

    const meta = document.createElement("div");
    meta.className = "file-item-meta";

    if (entry.status === "pending") {
      const badge = document.createElement("span");
      badge.textContent = "расчёт...";
      meta.appendChild(badge);
    } else if (entry.status === "error") {
      const badge = document.createElement("span");
      badge.textContent = "ошибка";
      meta.appendChild(badge);
    } else {
      const volume = (entry.rawVolume || 0) * scale;
      const weight = volume * WAX_DENSITY;
      const volumeBadge = document.createElement("span");
      volumeBadge.textContent = `${volume.toFixed(2)} см³`;
      const weightBadge = document.createElement("span");
      weightBadge.textContent = `${weight.toFixed(2)} г`;
      meta.append(volumeBadge, weightBadge);
    }

    item.append(name, meta);
    elements.fileList.appendChild(item);
  });

  if (elements.fileCount) {
    elements.fileCount.textContent = state.files.length;
  }
}

function ensureSnapshot() {
  if (!state.snapshotDataUrl) {
    captureSnapshot();
  }
  return state.snapshotDataUrl || elements.snapshot.getAttribute("src") || "";
}

async function uploadSnapshot(dataUrl) {
  try {
    const response = await fetch("/api/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result?.ok && result.url) {
      if (state.snapshotUrl && state.snapshotUrl.startsWith("blob:")) {
        URL.revokeObjectURL(state.snapshotUrl);
      }
      state.snapshotUrl = result.url;
      elements.download.href = result.url;
      return result.url;
    }
  } catch (error) {}
  return null;
}

async function parseFileForRender(file) {
  const buffer = await readArrayBuffer(file);
  const binary = isBinarySTL(buffer);
  return binary ? parseBinarySTL(buffer) : parseAsciiSTL(buffer);
}

async function parseFileVolumeOnly(file) {
  const buffer = await readArrayBuffer(file);
  const binary = isBinarySTL(buffer);
  return binary ? parseBinarySTLVolume(buffer) : parseAsciiSTLVolume(buffer);
}

async function selectFile(index) {
  const entry = state.files[index];
  if (!entry) return;
  if (state.currentIndex === index && state.vertexCount > 0) return;

  state.currentIndex = index;
  updateFileName(entry, index);
  updateFileList();
  updateMetrics();

  if (entry.status !== "ready") {
    setStatus("Файл ещё обрабатывается. Подождите.");
    return;
  }

  const token = (state.selectToken += 1);
  setStatus(`Загружаю модель: ${entry.name}...`);
  setError("");

  try {
    const parsed = await parseFileForRender(entry.file);
    if (token !== state.selectToken) return;
    entry.rawVolume = parsed.volume;
    updateFileList();
    handleParsed(parsed, {
      statusMessage: "Готово. Можно вращать модель и делать скриншот.",
    });
  } catch (error) {
    setError("Не удалось прочитать STL. Проверьте файл.");
  }
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  const stlFiles = files.filter((file) =>
    file.name.toLowerCase().endsWith(".stl")
  );
  if (!stlFiles.length) {
    setStatus("Нужен STL‑файл (binary или ASCII).");
    return;
  }

  resetBatch();
  const loadId = (state.loadId += 1);

  state.files = stlFiles.map((file) => ({
    file,
    name: file.name,
    rawVolume: 0,
    status: "pending",
  }));

  updateFileList();
  setStatus(`Загружаю ${state.files.length} моделей...`);
  setError("");
  if (elements.fileInput) elements.fileInput.value = "";

  for (const entry of state.files) {
    if (loadId !== state.loadId) return;

    try {
      if (state.currentIndex === -1) {
        const parsed = await parseFileForRender(entry.file);
        entry.rawVolume = parsed.volume;
        entry.status = "ready";
        state.currentIndex = state.files.indexOf(entry);
        updateFileName(entry, state.currentIndex);
        handleParsed(parsed);
      } else {
        const volume = await parseFileVolumeOnly(entry.file);
        entry.rawVolume = volume;
        entry.status = "ready";
      }
    } catch (error) {
      entry.status = "error";
    }

    updateFileList();
    updateMetrics();
  }

  const hasReady = state.files.some((entry) => entry.status === "ready");
  if (!hasReady) {
    setStatus("Не удалось загрузить STL‑модели. Проверьте файлы.");
  } else if (state.files.length > 1) {
    setStatus("Готово. Выберите модель из списка для просмотра.");
  }
}

function captureSnapshot() {
  if (!state.gl || state.vertexCount === 0) return;
  render();
  if (state.snapshotUrl && state.snapshotUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.snapshotUrl);
  }
  state.snapshotUrl = null;
  const baseCanvas = elements.canvas;
  const shot = document.createElement("canvas");
  shot.width = baseCanvas.width;
  shot.height = baseCanvas.height;
  const ctx = shot.getContext("2d");
  if (!ctx) return;
  const bg = ctx.createLinearGradient(0, 0, shot.width, shot.height);
  bg.addColorStop(0, "#0b0a09");
  bg.addColorStop(0.55, "#14100d");
  bg.addColorStop(1, "#2b1f14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, shot.width, shot.height);

  const glow = ctx.createRadialGradient(
    shot.width * 0.78,
    shot.height * 0.12,
    0,
    shot.width * 0.78,
    shot.height * 0.12,
    shot.width * 0.7
  );
  glow.addColorStop(0, "rgba(212, 175, 55, 0.2)");
  glow.addColorStop(0.6, "rgba(212, 175, 55, 0.05)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, shot.width, shot.height);

  ctx.drawImage(baseCanvas, 0, 0);

  const text = "@topform3d";
  const padding = Math.max(16, Math.round(shot.width * 0.025));
  const fontSize = Math.max(18, Math.round(shot.width * 0.04));
  const boxHeight = Math.round(fontSize * 1.6);
  const metrics = ctx.measureText(text);
  const boxWidth = Math.round(metrics.width + fontSize * 1.6);
  const x = shot.width - padding;
  const y = shot.height - padding;

  ctx.fillStyle = "rgba(5, 4, 3, 0.65)";
  ctx.strokeStyle = "rgba(212, 175, 55, 0.55)";
  ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.08));
  ctx.beginPath();
  ctx.rect(x - boxWidth, y - boxHeight, boxWidth, boxHeight);
  ctx.fill();
  ctx.stroke();

  ctx.font = `600 ${fontSize}px "Manrope", sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 235, 190, 0.95)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.18));
  ctx.fillText(text, x - fontSize * 0.4, y - boxHeight / 2);
  ctx.shadowBlur = 0;

  const dataUrl = shot.toDataURL("image/png");
  state.snapshotDataUrl = dataUrl;
  elements.snapshot.src = dataUrl;
  elements.download.href = dataUrl;
  if (shot.toBlob) {
    shot.toBlob((blob) => {
      if (!blob) return;
      if (!/^https?:/i.test(state.snapshotUrl || "")) {
        state.snapshotUrl = URL.createObjectURL(blob);
        elements.download.href = state.snapshotUrl;
      }
    }, "image/png");
  } else {
    fetch(dataUrl)
      .then((res) => res.blob())
      .then((blob) => {
        if (!/^https?:/i.test(state.snapshotUrl || "")) {
          state.snapshotUrl = URL.createObjectURL(blob);
          elements.download.href = state.snapshotUrl;
        }
      })
      .catch(() => {});
  }

  uploadSnapshot(dataUrl);
}

function initWebGL() {
  const gl = elements.canvas.getContext("webgl", {
    preserveDrawingBuffer: true,
    antialias: true,
  });
  if (!gl) {
    setError("WebGL не поддерживается на этом устройстве.");
    return;
  }

  const vsSource = `
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 uMVP;
    uniform mat3 uNormal;
    varying float vLight;
    varying float vRim;
    void main() {
      vec3 n = normalize(uNormal * normal);
      vec3 lightA = normalize(vec3(0.4, 0.7, 0.5));
      vec3 lightB = normalize(vec3(-0.6, 0.2, 0.7));
      float diff = max(dot(n, lightA), 0.0) * 0.7 + max(dot(n, lightB), 0.0) * 0.3;
      vLight = diff + 0.25;
      float facing = max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0);
      vRim = pow(1.0 - facing, 2.0);
      gl_Position = uMVP * vec4(position, 1.0);
    }
  `;

  const fsSource = `
    precision mediump float;
    uniform vec3 uColor;
    varying float vLight;
    varying float vRim;
    void main() {
      vec3 base = uColor * vLight;
      vec3 rim = vec3(1.0, 0.95, 0.85) * vRim * 0.35;
      gl_FragColor = vec4(base + rim, 1.0);
    }
  `;

  try {
    state.program = createProgram(gl, vsSource, fsSource);
  } catch (error) {
    setError("Ошибка инициализации WebGL.");
    return;
  }

  state.gl = gl;
  state.attribs = {
    position: gl.getAttribLocation(state.program, "position"),
    normal: gl.getAttribLocation(state.program, "normal"),
  };
  state.uniforms = {
    mvp: gl.getUniformLocation(state.program, "uMVP"),
    normal: gl.getUniformLocation(state.program, "uNormal"),
    color: gl.getUniformLocation(state.program, "uColor"),
  };

  gl.enable(gl.DEPTH_TEST);
  resizeCanvas();
  render();
}

function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  tg.ready();
  if (typeof tg.expand === "function") tg.expand();
  if (typeof tg.setHeaderColor === "function") tg.setHeaderColor("#f5efe7");
}

function bindEvents() {
  elements.fileButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", (event) =>
    handleFiles(event.target.files)
  );
  if (elements.pickFileMobile) {
    elements.pickFileMobile.addEventListener("click", () =>
      elements.fileInput.click()
    );
  }

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("hover");
  });
  elements.dropZone.addEventListener("dragleave", () =>
    elements.dropZone.classList.remove("hover")
  );
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("hover");
    handleFiles(event.dataTransfer.files);
  });

  elements.units.addEventListener("change", () => {
    updateMetrics();
    updateFileList();
    scheduleRender(5);
  });

  elements.capture.addEventListener("click", () => {
    captureSnapshot();
  });

  const isTelegram = Boolean(window.Telegram?.WebApp);
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
  elements.download.addEventListener("click", async (event) => {
    const dataUrl = ensureSnapshot();
    const remoteUrl = /^https?:/i.test(state.snapshotUrl || "")
      ? state.snapshotUrl
      : await uploadSnapshot(dataUrl);
    const url = remoteUrl || state.snapshotUrl || dataUrl;
    if (!url) return;
    elements.download.href = url;
    if (!isTelegram && !isIOS) return;
    event.preventDefault();
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink && /^https?:/i.test(url)) {
      tg.openLink(url);
    } else {
      window.open(url, "_blank");
    }
  });

  elements.canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    elements.canvas.setPointerCapture(event.pointerId);
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    state.rotation.yaw += dx * 0.005;
    state.rotation.pitch += dy * 0.005;
    if (state.rotation.pitch > Math.PI) state.rotation.pitch -= Math.PI * 2;
    if (state.rotation.pitch < -Math.PI) state.rotation.pitch += Math.PI * 2;
    scheduleRender(2);
  });

  elements.canvas.addEventListener("pointerup", (event) => {
    state.dragging = false;
    elements.canvas.releasePointerCapture(event.pointerId);
  });

  elements.canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * 0.12;
      state.zoom = Math.min(3.5, Math.max(0.4, state.zoom - delta));
      scheduleRender(4);
    },
    { passive: false }
  );

  elements.canvas.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      state.pinch.active = true;
      state.pinch.distance = Math.hypot(dx, dy);
    }
  });

  elements.canvas.addEventListener("touchmove", (event) => {
    if (!state.pinch.active || event.touches.length !== 2) return;
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (state.pinch.distance > 0) {
      const scale = dist / state.pinch.distance;
      state.zoom = Math.min(3.5, Math.max(0.4, state.zoom * scale));
      scheduleRender(4);
    }
    state.pinch.distance = dist;
  });

  elements.canvas.addEventListener("touchend", () => {
    state.pinch.active = false;
  });

  if (elements.rotateLeft) {
    elements.rotateLeft.addEventListener("click", () => {
      state.rotation.yaw -= 0.25;
      scheduleRender(4);
    });
    elements.rotateRight.addEventListener("click", () => {
      state.rotation.yaw += 0.25;
      scheduleRender(4);
    });
    elements.rotateUp.addEventListener("click", () => {
      state.rotation.pitch -= 0.25;
      scheduleRender(4);
    });
    elements.rotateDown.addEventListener("click", () => {
      state.rotation.pitch += 0.25;
      scheduleRender(4);
    });
  }

  if (elements.zoomIn) {
    elements.zoomIn.addEventListener("click", () => {
      state.zoom = Math.min(3.5, state.zoom + 0.15);
      scheduleRender(4);
    });
  }
  if (elements.zoomOut) {
    elements.zoomOut.addEventListener("click", () => {
      state.zoom = Math.max(0.4, state.zoom - 0.15);
      scheduleRender(4);
    });
  }

  if (elements.resetView) {
    elements.resetView.addEventListener("click", () => {
      state.rotation = { yaw: 0.6, pitch: -0.4 };
      state.zoom = 1;
      scheduleRender(10);
    });
  }

  const shareUrl = window.location.origin;
  const shareText =
    "3D калькулятор объема моделей от Top Form. STL -> объем и вес восковки.";

  const shareToBrowser = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Top Form 3D",
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (error) {}
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setStatus("Ссылка скопирована в буфер обмена.");
        return;
      } catch (error) {}
    }
    window.prompt("Скопируйте ссылку:", shareUrl);
  };

  const shareToTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(
      shareUrl
    )}&text=${encodeURIComponent(shareText)}`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, "_blank");
    }
  };

  if (elements.shareWeb) {
    elements.shareWeb.addEventListener("click", async () => {
      await shareToBrowser();
    });
  }

  if (elements.shareTg) {
    elements.shareTg.addEventListener("click", () => {
      shareToTelegram();
    });
  }

  window.addEventListener("resize", () => {
    resizeCanvas();
    scheduleRender(10);
  });
}

function init() {
  try {
    initTelegram();
    initWebGL();
    bindEvents();
    setStatus("Готово к загрузке STL.");
    saveUser();
    updateMetals();
    scheduleRender(5);
  } catch (error) {
    setError("Ошибка запуска приложения.");
  }
}

init();

function saveUser() {
  const tg = window.Telegram?.WebApp;
  const user = tg?.initDataUnsafe?.user;
  const payload = user && user.id
    ? {
        user_id: user.id,
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        language_code: user.language_code || null,
        platform: tg?.platform || "telegram",
        ts: Date.now(),
      }
    : {
        client_id: getClientId(),
        platform: "web",
        ts: Date.now(),
      };

  const body = JSON.stringify(payload);
  fetch("/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data) setDailyCounters(data);
    })
    .catch(() => {
      updateDailyCounter();
    });
  setTimeout(updateDailyCounter, 1200);
}

function scheduleRender(frames) {
  state.renderFrames = Math.max(state.renderFrames, frames);
  if (state.renderLoopActive) return;
  state.renderLoopActive = true;
  const loop = () => {
    if (state.renderFrames <= 0) {
      state.renderLoopActive = false;
      return;
    }
    state.renderFrames -= 1;
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function readArrayBuffer(file) {
  if (file.arrayBuffer) {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function updateDailyCounter() {
  if (!elements.tgTotal && !elements.webTotal) return;
  try {
    const response = await fetch(`/api/visits?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("bad response");
    const payload = await response.json();
    setDailyCounters(payload);
  } catch (error) {
    if (elements.tgTotal) elements.tgTotal.textContent = "—";
    if (elements.tgUnique) elements.tgUnique.textContent = "—";
    if (elements.tgRepeat) elements.tgRepeat.textContent = "—";
    if (elements.webTotal) elements.webTotal.textContent = "—";
    if (elements.webUnique) elements.webUnique.textContent = "—";
    if (elements.webRepeat) elements.webRepeat.textContent = "—";
  }
}

async function updateMetals() {
  if (!elements.metalDate) return;
  try {
    const response = await fetch(`/api/metals?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("bad response");
    const payload = await response.json();
    const prices = payload?.prices || {};
    const formatter = new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
    });
    const toNumber = (value) => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = Number(value.replace(",", "."));
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const setValue = (el, value) => {
      if (!el) return;
      const num = toNumber(value);
      el.textContent = Number.isFinite(num) ? formatter.format(num) : "—";
    };

    const dateText = payload?.date || "";
    let displayDate = "—";
    if (dateText.includes("-")) {
      const parts = dateText.split("-");
      if (parts.length === 3) {
        displayDate = `${parts[2]}.${parts[1]}.${parts[0]}`;
      }
    } else if (dateText) {
      const date = new Date(dateText);
      displayDate = Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleDateString("ru-RU");
    }
    elements.metalDate.textContent = displayDate;
    setValue(elements.metalAu, prices.Au);
    setValue(elements.metalAg, prices.Ag);
    setValue(elements.metalPt, prices.Pt);
    setValue(elements.metalPd, prices.Pd);
  } catch (error) {
    elements.metalDate.textContent = "—";
    if (elements.metalAu) elements.metalAu.textContent = "—";
    if (elements.metalAg) elements.metalAg.textContent = "—";
    if (elements.metalPt) elements.metalPt.textContent = "—";
    if (elements.metalPd) elements.metalPd.textContent = "—";
  }
}

function getClientId() {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored) return stored;
    const id =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch (error) {
    return `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}
