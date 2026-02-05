const THREE = window.THREE;
const OrbitControls = THREE?.OrbitControls;
const STLLoader = THREE?.STLLoader;

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

const state = {
  geometry: null,
  mesh: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  rawVolume: 0,
};

function setStatus(message) {
  elements.status.textContent = message;
}

function setError(message) {
  if (elements.error) {
    elements.error.textContent = message || "";
  }
}

function setMetrics(volumeCm3) {
  const weight = volumeCm3 * WAX_DENSITY;
  elements.volume.textContent = volumeCm3.toFixed(2);
  elements.weight.textContent = weight.toFixed(2);
}

function computeVolumeFromPositions(positions) {
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];
    volume +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }
  return Math.abs(volume / 6);
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
  let offset = 84;
  let p = 0;
  let volume = 0;

  for (let i = 0; i < triCount; i++) {
    offset += 12; // normal
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
    offset += 2; // attribute byte count

    positions[p++] = ax;
    positions[p++] = ay;
    positions[p++] = az;
    positions[p++] = bx;
    positions[p++] = by;
    positions[p++] = bz;
    positions[p++] = cx;
    positions[p++] = cy;
    positions[p++] = cz;

    volume +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.center();

  return { geometry, volume: Math.abs(volume / 6) };
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry.dispose();
  mesh.material.dispose();
  state.scene.remove(mesh);
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (state.camera.fov * Math.PI) / 180;
  let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  cameraZ *= 1.6;

  state.camera.position.set(
    center.x + cameraZ,
    center.y + cameraZ * 0.6,
    center.z + cameraZ
  );
  state.camera.near = maxDim / 100;
  state.camera.far = maxDim * 100;
  state.camera.updateProjectionMatrix();
  state.controls.target.copy(center);
  state.controls.update();
}

function setupScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8f2ea);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  camera.position.set(0, 0, 120);

  const renderer = new THREE.WebGLRenderer({
    canvas: elements.canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  const directional = new THREE.DirectionalLight(0xffffff, 0.7);
  directional.position.set(6, 12, 10);
  scene.add(ambient, directional);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;

  resizeRenderer();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

function resizeRenderer() {
  if (!state.renderer) return;
  const width = elements.canvas.clientWidth;
  const height = elements.canvas.clientHeight;
  state.renderer.setSize(width, height, false);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
}

function updateMetricsFromGeometry() {
  if (!state.geometry) return;
  const unit = elements.units.value;
  const volumeCm3 = state.rawVolume * (UNIT_SCALE[unit] || 1);
  setMetrics(volumeCm3);
}

function loadGeometry(buffer) {
  let geometry;
  let volume;

  if (isBinarySTL(buffer)) {
    const parsed = parseBinarySTL(buffer);
    geometry = parsed.geometry;
    volume = parsed.volume;
  } else {
    if (!STLLoader) {
      setError("ASCII STL требует STLLoader. Проверьте загрузку библиотек.");
      return;
    }
    const loader = new STLLoader();
    geometry = loader.parse(buffer);
    geometry.computeBoundingBox();
    geometry.center();
    const positions = geometry.attributes.position.array;
    volume = computeVolumeFromPositions(positions);
    setStatus("ASCII STL обрабатывается дольше. Лучше использовать binary STL.");
  }

  disposeMesh(state.mesh);

  const material = new THREE.MeshBasicMaterial({ color: 0xcaa06f });
  const mesh = new THREE.Mesh(geometry, material);
  state.scene.add(mesh);

  state.geometry = geometry;
  state.mesh = mesh;
  state.rawVolume = volume;

  elements.empty.style.display = "none";
  fitCameraToObject(mesh);
  updateMetricsFromGeometry();
  setStatus("Готово. Можно вращать модель и делать скриншот.");
  setTimeout(captureSnapshot, 80);
}

async function handleFile(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".stl")) {
    setStatus("Нужен STL‑файл (binary или ASCII).");
    return;
  }

  elements.fileName.textContent = file.name;
  try {
    setStatus("Загружаю модель...");
    setError("");
    const buffer = await file.arrayBuffer();
    loadGeometry(buffer);
  } catch (error) {
    setStatus("Не удалось прочитать файл.");
  }
}

function captureSnapshot() {
  if (!state.renderer || !state.mesh) return;
  state.renderer.render(state.scene, state.camera);
  const dataUrl = state.renderer.domElement.toDataURL("image/png");
  elements.snapshot.src = dataUrl;
  elements.download.href = dataUrl;
}

function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  tg.ready();
  if (typeof tg.expand === "function") {
    tg.expand();
  }
  if (typeof tg.setHeaderColor === "function") {
    tg.setHeaderColor("#f5efe7");
  }
}

function wireEvents() {
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
    updateMetricsFromGeometry();
  });

  elements.capture.addEventListener("click", () => {
    captureSnapshot();
  });

  window.addEventListener("resize", resizeRenderer);
}

function init() {
  if (!THREE || !OrbitControls) {
    setError(
      "Не удалось загрузить Three.js. Проверьте соединение или CDN."
    );
    return;
  }
  initTelegram();
  setupScene();
  wireEvents();
}

init();
