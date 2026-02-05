import * as THREE from "https://unpkg.com/three@0.160.1/build/three.module.js";
import { STLLoader } from "https://unpkg.com/three@0.160.1/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.1/examples/jsm/controls/OrbitControls.js";

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
};

const state = {
  geometry: null,
  mesh: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  lastVolume: 0,
};

function setStatus(message) {
  elements.status.textContent = message;
}

function setMetrics(volumeCm3) {
  const weight = volumeCm3 * WAX_DENSITY;
  elements.volume.textContent = volumeCm3.toFixed(2);
  elements.weight.textContent = weight.toFixed(2);
}

function computeVolume(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  let volume = 0;

  const getVertex = (i) => {
    const ix = i * 3;
    return {
      x: position.array[ix],
      y: position.array[ix + 1],
      z: position.array[ix + 2],
    };
  };

  const addTriangle = (a, b, c) => {
    volume +=
      a.x * (b.y * c.z - b.z * c.y) -
      a.y * (b.x * c.z - b.z * c.x) +
      a.z * (b.x * c.y - b.y * c.x);
  };

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = getVertex(index.array[i]);
      const b = getVertex(index.array[i + 1]);
      const c = getVertex(index.array[i + 2]);
      addTriangle(a, b, c);
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      const a = getVertex(i);
      const b = getVertex(i + 1);
      const c = getVertex(i + 2);
      addTriangle(a, b, c);
    }
  }

  return Math.abs(volume / 6);
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

  state.camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.6, center.z + cameraZ);
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
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const directional = new THREE.DirectionalLight(0xffffff, 0.9);
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
  const rawVolume = computeVolume(state.geometry);
  const unit = elements.units.value;
  const volumeCm3 = rawVolume * (UNIT_SCALE[unit] || 1);
  state.lastVolume = volumeCm3;
  setMetrics(volumeCm3);
}

function loadGeometry(buffer) {
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);
  geometry.computeVertexNormals();

  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  disposeMesh(state.mesh);

  const material = new THREE.MeshStandardMaterial({
    color: 0xcaa06f,
    roughness: 0.5,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  state.scene.add(mesh);

  state.geometry = geometry;
  state.mesh = mesh;

  elements.empty.style.display = "none";
  fitCameraToObject(mesh);
  updateMetricsFromGeometry();
  setStatus("Готово. Можно вращать модель и делать скриншот.");
  setTimeout(captureSnapshot, 120);
}

function handleFile(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".stl")) {
    setStatus("Нужен STL‑файл (binary или ASCII).");
    return;
  }

  elements.fileName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => loadGeometry(reader.result);
  reader.onerror = () => setStatus("Не удалось прочитать файл.");
  reader.readAsArrayBuffer(file);
  setStatus("Загружаю модель...");
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

initTelegram();
setupScene();
