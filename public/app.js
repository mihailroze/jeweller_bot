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
  volume: document.getElementById("volume"),
  weight: document.getElementById("weight"),
  status: document.getElementById("status"),
  capture: document.getElementById("capture"),
  download: document.getElementById("download"),
  snapshot: document.getElementById("snapshot"),
  empty: document.getElementById("empty"),
  canvas: document.getElementById("viewer"),
  error: document.getElementById("error"),
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
  scale: 1,
  rotation: { yaw: 0.6, pitch: -0.4 },
  dragging: false,
  lastPointer: { x: 0, y: 0 },
  renderFrames: 0,
  renderLoopActive: false,
  autoSpinFrames: 0,
};

function setStatus(message) {
  elements.status.textContent = message;
}

function setError(message) {
  if (elements.error) elements.error.textContent = message || "";
}

function setMetrics(volumeCm3) {
  const weight = volumeCm3 * WAX_DENSITY;
  elements.volume.textContent = volumeCm3.toFixed(2);
  elements.weight.textContent = weight.toFixed(2);
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
  const a00 = a[0],
    a01 = a[1],
    a02 = a[2],
    a03 = a[3];
  const a10 = a[4],
    a11 = a[5],
    a12 = a[6],
    a13 = a[7];
  const a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  const a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];

  const b00 = b[0],
    b01 = b[1],
    b02 = b[2],
    b03 = b[3];
  const b10 = b[4],
    b11 = b[5],
    b12 = b[6],
    b13 = b[7];
  const b20 = b[8],
    b21 = b[9],
    b22 = b[10],
    b23 = b[11];
  const b30 = b[12],
    b31 = b[13],
    b32 = b[14],
    b33 = b[15];

  out[0] = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
  out[1] = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
  out[2] = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
  out[3] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;
  out[4] = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
  out[5] = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
  out[6] = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32;
  out[7] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;
  out[8] = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
  out[9] = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
  out[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
  out[11] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;
  out[12] = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;
  out[13] = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;
  out[14] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;
  out[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;
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
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
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
  const width = Math.max(1, Math.floor(elements.canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(elements.canvas.clientHeight * dpr));
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
  const view = mat4LookAt([0, 0, 3], [0, 0, 0], [0, 1, 0]);
  const model = buildModelMatrix(
    state.rotation.yaw,
    state.rotation.pitch,
    state.scale
  );
  const mvp = mat4Multiply(projection, mat4Multiply(view, model));
  const normal = buildNormalMatrix(state.rotation.yaw, state.rotation.pitch);

  gl.clearColor(0.98, 0.96, 0.93, 1);
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
  state.scale = 1 / maxDim;
  scheduleRender(60);
}

function updateMetrics() {
  const unit = elements.units.value;
  const volumeCm3 = state.rawVolume * (UNIT_SCALE[unit] || 1);
  setMetrics(volumeCm3);
}

function handleParsed(parsed) {
  if (!parsed.positions.length) {
    setError("Файл не содержит треугольников.");
    return;
  }

  const maxDim = centerGeometry(parsed.positions, parsed.bounds);
  state.rawVolume = parsed.volume;
  updateMetrics();
  uploadGeometry(parsed.positions, parsed.normals, maxDim);
  elements.empty.style.display = "none";
  setStatus("Готово. Можно вращать модель и делать скриншот.");
  state.autoSpinFrames = 120;
  setTimeout(captureSnapshot, 120);
}

async function handleFile(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".stl")) {
    setStatus("Нужен STL‑файл (binary или ASCII).");
    return;
  }

  elements.fileName.textContent = file.name;
  setStatus("Загружаю модель...");
  setError("");

  try {
    const buffer = await readArrayBuffer(file);
    const binary = isBinarySTL(buffer);
    const parsed = binary ? parseBinarySTL(buffer) : parseAsciiSTL(buffer);
    if (!binary) {
      setStatus("ASCII STL обрабатывается дольше. Лучше использовать binary.");
    }
    handleParsed(parsed);
  } catch (error) {
    setError("Не удалось прочитать STL. Проверьте файл.");
  }
}

function captureSnapshot() {
  if (!state.gl || state.vertexCount === 0) return;
  render();
  const dataUrl = elements.canvas.toDataURL("image/png");
  elements.snapshot.src = dataUrl;
  elements.download.href = dataUrl;
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
    handleFile(event.target.files[0])
  );

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
    const file = event.dataTransfer.files[0];
    handleFile(file);
  });

  elements.units.addEventListener("change", () => {
    updateMetrics();
    scheduleRender(5);
  });

  elements.capture.addEventListener("click", () => {
    captureSnapshot();
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
    state.rotation.pitch = Math.max(
      -1.4,
      Math.min(1.4, state.rotation.pitch)
    );
    scheduleRender(2);
  });

  elements.canvas.addEventListener("pointerup", (event) => {
    state.dragging = false;
    elements.canvas.releasePointerCapture(event.pointerId);
  });

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
    scheduleRender(5);
  } catch (error) {
    setError("Ошибка запуска приложения.");
  }
}

init();

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
