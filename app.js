import * as THREE from "./node_modules/three/build/three.module.js";

const diceButtons = document.querySelectorAll(".die-picker");
const poolList = document.querySelector("#pool-list");
const diceCount = document.querySelector("#dice-count");
const clearPoolButton = document.querySelector("#clear-pool");
const rollButton = document.querySelector("#roll-button");
const modifierInput = document.querySelector("#modifier");
const diceTotalOutput = document.querySelector("#dice-total");
const modifierTotalOutput = document.querySelector("#modifier-total");
const grandTotalOutput = document.querySelector("#grand-total");
const critBanner = document.querySelector("#crit-banner");
const rollLog = document.querySelector("#roll-log");
const stage = document.querySelector("#die-stage");
const stageMessage = document.querySelector("#stage-message");
const canvas = document.querySelector("#dice-canvas");

const diceSoundUrl = "./assets/dice.mp3";
const dieTypes = [4, 6, 8, 10, 12, 20];
const fullTurn = Math.PI * 2;

const dieColors = {
  4: 0xf6c766,
  6: 0x43d7c4,
  8: 0x7dd6ff,
  10: 0x9287ff,
  12: 0xff8ea6,
  20: 0xf7f0df
};

const labelOffsets = {
  4: 1.08,
  6: 0.76,
  8: 1.12,
  10: 1.08,
  12: 1.08,
  20: 1.1
};

let dicePool = [];
let dieActors = [];
let isRolling = false;
let audioContext = null;
let audioMaster = null;
let diceSoundBuffer = null;
let diceSoundLoadPromise = null;
let diceSoundLoadError = null;
let lastAudioEvents = [];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 4.1, 8);

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const hemiLight = new THREE.HemisphereLight(0xf7f0df, 0x14222a, 1.75);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(3.5, 7, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 18;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x43d7c4, 1.35);
rimLight.position.set(-5, 3, -4);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(7, 64),
  new THREE.ShadowMaterial({
    color: 0x02080a,
    opacity: 0.28
  })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.28;
floor.receiveShadow = true;
scene.add(floor);

function getAudioContext() {
  // Browsers intentionally keep sound locked until the user does something.
  // We create the audio system early, but resume it from the Roll button click.
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
    audioMaster = audioContext.createGain();
    audioMaster.gain.value = 0.72;
    audioMaster.connect(audioContext.destination);
  }

  return audioContext;
}

function loadDiceSound() {
  if (diceSoundLoadPromise) {
    return diceSoundLoadPromise;
  }

  const context = getAudioContext();

  if (!context) {
    diceSoundLoadPromise = Promise.resolve(null);
    return diceSoundLoadPromise;
  }

  diceSoundLoadPromise = fetch(diceSoundUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${diceSoundUrl}`);
      }

      return response.arrayBuffer();
    })
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      diceSoundBuffer = buffer;
      return buffer;
    })
    .catch((error) => {
      // Sound is flavor, not a game-breaking dependency. Keep the dice moving.
      diceSoundLoadError = error;
      console.warn("Dice sound is unavailable:", error);
      return null;
    });

  return diceSoundLoadPromise;
}

async function unlockAudioForRoll() {
  const context = getAudioContext();

  if (!context) {
    return null;
  }

  try {
    if (context.state === "suspended") {
      await context.resume();
    }
  } catch (error) {
    diceSoundLoadError = error;
    return null;
  }

  return loadDiceSound();
}

function connectSoundNodes(source, volume, pan) {
  const context = getAudioContext();
  const gain = context.createGain();

  gain.gain.value = volume;
  source.connect(gain);

  if (context.createStereoPanner) {
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner);
    panner.connect(audioMaster);
    return;
  }

  gain.connect(audioMaster);
}

function playDiceSoundSlice({ duration, offset, pan, playbackRate, volume, when }) {
  if (!diceSoundBuffer || !audioContext) {
    return;
  }

  const source = audioContext.createBufferSource();
  const safeOffset = Math.min(offset, Math.max(0, diceSoundBuffer.duration - 0.05));
  const safeDuration = Math.min(duration, diceSoundBuffer.duration - safeOffset);

  if (safeDuration <= 0) {
    return;
  }

  source.buffer = diceSoundBuffer;
  source.playbackRate.value = playbackRate;
  connectSoundNodes(source, volume, pan);
  source.start(Math.max(audioContext.currentTime, when), safeOffset, safeDuration);
}

async function scheduleRollAudio(actors, animationStartedAt, audioReadyPromise) {
  try {
    const buffer = await audioReadyPromise;

    if (!buffer || !audioContext) {
      return;
    }

    const elapsedSeconds = (performance.now() - animationStartedAt) / 1000;
    const now = audioContext.currentTime;
    const bufferTailOffset = Math.max(0, buffer.duration * 0.58);
    const bedDuration = Math.min(buffer.duration, 1.35);
    lastAudioEvents = [];

    if (elapsedSeconds < 0.45) {
      const bedWhen = now + 0.01;

      lastAudioEvents.push({ at: bedWhen, kind: "roll-bed" });
      playDiceSoundSlice({
        duration: bedDuration,
        offset: 0,
        pan: 0,
        playbackRate: 0.92 + Math.random() * 0.08,
        volume: 0.26,
        when: bedWhen
      });
    }

    actors.forEach((actor, index) => {
      const state = actor.rollState;

      if (!state) {
        return;
      }

      const landingSeconds = Math.max(0, state.duration / 1000 - elapsedSeconds - 0.05);
      const landingWhen = now + landingSeconds;
      const pan = THREE.MathUtils.clamp(actor.home.x / 4.5, -0.75, 0.75);
      const volume = Math.max(0.18, 0.44 - index * 0.035);

      lastAudioEvents.push({
        at: landingWhen,
        die: `D${actor.sides}`,
        kind: "landing"
      });

      playDiceSoundSlice({
        duration: Math.min(0.28, buffer.duration - bufferTailOffset),
        offset: bufferTailOffset,
        pan,
        playbackRate: 0.86 + Math.random() * 0.24,
        volume,
        when: landingWhen
      });
    });
  } catch (error) {
    diceSoundLoadError = error;
  }
}

function formatModifier(value) {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}

function getModifier() {
  // Number() turns the text in the input into a number JavaScript can add.
  // When the box is empty or contains something odd, Number(...) can produce
  // NaN, which means "Not a Number". The || 0 keeps the app from breaking.
  return Number(modifierInput.value) || 0;
}

function rollDie(sides) {
  // Math.random() returns a decimal from 0 up to, but not including, 1.
  // Example: 0.0000 can happen, 0.9999 can happen, but 1.0000 cannot.
  const zeroToAlmostOne = Math.random();

  // Multiplying by the die size stretches that range.
  // For a D20, this becomes 0 up to 19.9999...
  const zeroToAlmostSides = zeroToAlmostOne * sides;

  // Math.floor() chops off the decimal.
  // For a D20, this gives an integer from 0 to 19.
  const zeroBasedRoll = Math.floor(zeroToAlmostSides);

  // Dice start at 1, not 0, so add 1 at the end.
  // Final D20 range: 1 through 20.
  return zeroBasedRoll + 1;
}

function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

function createPentagonalBipyramidGeometry() {
  // A D10 is usually a pentagonal trapezohedron. This simplified shape is a
  // pentagonal bipyramid: still ten triangular faces, still reads as a D10,
  // and much easier to reason about before the future physics pass.
  const positions = [];
  const radius = 1.02;
  const height = 1.22;

  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * fullTurn - Math.PI / 2;
    const nextAngle = ((index + 1) / 5) * fullTurn - Math.PI / 2;
    const point = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
    const nextPoint = [Math.cos(nextAngle) * radius, 0, Math.sin(nextAngle) * radius];
    const top = [0, height, 0];
    const bottom = [0, -height, 0];

    positions.push(...top, ...point, ...nextPoint);
    positions.push(...bottom, ...nextPoint, ...point);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createDieGeometry(sides) {
  if (sides === 4) {
    return new THREE.TetrahedronGeometry(1.18, 0);
  }

  if (sides === 6) {
    return new THREE.BoxGeometry(1.45, 1.45, 1.45);
  }

  if (sides === 8) {
    return new THREE.OctahedronGeometry(1.18, 0);
  }

  if (sides === 10) {
    return createPentagonalBipyramidGeometry();
  }

  if (sides === 12) {
    return new THREE.DodecahedronGeometry(1.12, 0);
  }

  return new THREE.IcosahedronGeometry(1.14, 0);
}

function createLabelTexture() {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256;
  labelCanvas.height = 256;

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  return {
    canvas: labelCanvas,
    context: labelCanvas.getContext("2d"),
    texture
  };
}

function drawDieLabel(actor, text) {
  const { canvas: labelCanvas, context, texture } = actor.label;
  const label = String(text);
  const isDieName = label.startsWith("D");
  const fontSize = isDieName ? 78 : label.length > 2 ? 94 : 126;

  context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.save();
  context.translate(labelCanvas.width / 2, labelCanvas.height / 2);

  context.fillStyle = "rgba(247, 240, 223, 0.78)";
  context.beginPath();
  context.roundRect(-86, -62, 172, 124, 28);
  context.fill();

  context.lineWidth = 8;
  context.strokeStyle = "rgba(6, 16, 19, 0.16)";
  context.stroke();

  context.fillStyle = "#061013";
  context.font = `1000 ${fontSize}px Inter, Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 0, isDieName ? 4 : 2);
  context.restore();

  texture.needsUpdate = true;
}

function createDieActor(sides) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const geometry = createDieGeometry(sides);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: dieColors[sides],
      roughness: 0.42,
      metalness: 0.08,
      emissive: new THREE.Color(dieColors[sides]).multiplyScalar(0.06)
    })
  );
  const edgeLines = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 15),
    new THREE.LineBasicMaterial({
      color: 0x071116,
      transparent: true,
      opacity: 0.3
    })
  );
  const label = createLabelTexture();
  const labelPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.06, 0.74),
    new THREE.MeshBasicMaterial({
      map: label.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  );

  mesh.castShadow = true;
  edgeLines.renderOrder = 1;
  labelPlane.position.z = labelOffsets[sides];
  labelPlane.renderOrder = 2;

  body.add(mesh, edgeLines, labelPlane);
  group.add(body);
  scene.add(group);

  const actor = {
    baseScale: 1,
    body,
    group,
    home: new THREE.Vector3(),
    label,
    rollState: null,
    sides
  };

  body.rotation.copy(getRestRotation(sides, 0));
  drawDieLabel(actor, `D${sides}`);

  return actor;
}

function disposeObject(object) {
  if (object.geometry) {
    object.geometry.dispose();
  }

  if (!object.material) {
    return;
  }

  const materials = Array.isArray(object.material) ? object.material : [object.material];
  materials.forEach((material) => {
    if (material.map) {
      material.map.dispose();
    }

    material.dispose();
  });
}

function disposeDieActor(actor) {
  actor.group.traverse(disposeObject);
  scene.remove(actor.group);
}

function getRestRotation(sides, value) {
  // The labels are not trying to model the true face maps yet. Instead, the
  // die settles into a readable front-facing pose, with a tiny value-based
  // twist so repeated rolls do not freeze into the exact same silhouette.
  const twist = value ? ((value % sides) / sides - 0.5) * 0.44 : 0;

  return new THREE.Euler(
    -0.26 + twist * 0.25,
    0.34 + twist,
    0.12 - twist * 0.18,
    "XYZ"
  );
}

function getStageColumns(count) {
  const stageWidth = stage.clientWidth || 680;

  if (stageWidth < 520) {
    return Math.min(count, 2);
  }

  return Math.min(count, 4);
}

function layoutDiceActors() {
  const count = dieActors.length;

  if (count === 0) {
    camera.position.set(0, 4.1, 8);
    camera.lookAt(0, 0, 0);
    return;
  }

  const columns = getStageColumns(count);
  const rows = Math.ceil(count / columns);
  const spacing = stage.clientWidth < 520 ? 1.65 : 2.05;
  const scale = count > 8 ? 0.72 : count > 5 ? 0.82 : 0.94;

  dieActors.forEach((actor, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = (column - (columns - 1) / 2) * spacing;
    const z = (row - (rows - 1) / 2) * 1.55;

    actor.home.set(x, 0, z);
    actor.baseScale = scale;
    actor.group.position.copy(actor.home);
    actor.group.scale.setScalar(scale);
  });

  const cameraDistance = Math.max(7.3, columns * 1.65 + rows * 1.08 + 3.2);
  camera.position.set(0, 3.7 + rows * 0.22, cameraDistance);
  camera.lookAt(0, 0, 0);
}

function syncDiceActors() {
  dieActors.forEach(disposeDieActor);
  dieActors = dicePool.map((sides) => createDieActor(sides));
  layoutDiceActors();
}

function updatePoolDisplay() {
  diceCount.textContent = dicePool.length === 0
    ? "No dice loaded"
    : `${dicePool.length} dice loaded`;

  rollButton.disabled = dicePool.length === 0 || isRolling;
  stageMessage.classList.toggle("hidden", dicePool.length > 0);

  if (dicePool.length === 0) {
    poolList.className = "pool-list empty";
    poolList.textContent = "Select a die type to add it here.";
    return;
  }

  poolList.className = "pool-list";
  poolList.replaceChildren();

  dicePool.forEach((sides, index) => {
    const chip = document.createElement("span");
    chip.className = "pool-chip";
    chip.textContent = `D${sides}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "x";
    removeButton.setAttribute("aria-label", `Remove D${sides}`);
    removeButton.addEventListener("click", () => {
      if (isRolling) {
        return;
      }

      dicePool.splice(index, 1);
      syncDiceActors();
      updatePoolDisplay();
    });

    chip.append(removeButton);
    poolList.append(chip);
  });
}

function showCritBanner(message, isFailure) {
  critBanner.textContent = message;
  critBanner.classList.toggle("fail", isFailure);

  // Removing and re-adding the class restarts the CSS animation every time.
  critBanner.classList.remove("show");
  void critBanner.offsetWidth;
  critBanner.classList.add("show");
}

function clearCritBanner() {
  critBanner.classList.remove("show", "fail");
  critBanner.textContent = "";
}

function writeRollLog(results, diceTotal, modifier, grandTotal) {
  const logLine = document.createElement("p");
  const rollParts = results
    .map((result) => `D${result.sides}: ${result.value}`)
    .join(" | ");

  logLine.textContent = `${rollParts} | ${formatModifier(modifier)} = ${grandTotal}`;

  if (rollLog.querySelector("p")?.textContent === "No rolls yet.") {
    rollLog.replaceChildren();
  }

  rollLog.prepend(logLine);

  // Keep the log short so the station stays tidy.
  while (rollLog.children.length > 6) {
    rollLog.removeChild(rollLog.lastElementChild);
  }

  diceTotalOutput.textContent = diceTotal;
  modifierTotalOutput.textContent = formatModifier(modifier);
  grandTotalOutput.textContent = grandTotal;
}

function findD20Critical(results) {
  // A "natural" D20 result means the raw die face before modifiers are added.
  const d20Results = results.filter((result) => result.sides === 20);

  if (d20Results.some((result) => result.value === 20)) {
    return { message: "CRIT!", isFailure: false };
  }

  if (d20Results.some((result) => result.value === 1)) {
    return { message: "CRIT FAIL!", isFailure: true };
  }

  return null;
}

function startActorRoll(actor, result, index) {
  const startRotation = actor.body.rotation.clone();
  const readableRotation = getRestRotation(actor.sides, result.value);
  const spinDirection = index % 2 === 0 ? 1 : -1;
  const duration = 1220 + index * 90 + Math.random() * 120;
  const spinX = (3.5 + Math.random() * 1.8) * fullTurn * spinDirection;
  const spinY = (4 + Math.random() * 2) * fullTurn;
  const spinZ = (2.5 + Math.random() * 1.5) * fullTurn * -spinDirection;

  actor.rollState = {
    duration,
    finalLabelShown: false,
    finalRotation: readableRotation,
    lastPreviewAt: 0,
    result,
    sideways: (Math.random() - 0.5) * 0.46,
    startAt: performance.now(),
    startRotation,
    targetRotation: new THREE.Euler(
      readableRotation.x + spinX,
      readableRotation.y + spinY,
      readableRotation.z + spinZ,
      "XYZ"
    )
  };

  drawDieLabel(actor, "?");
}

function updateActorRoll(actor, now) {
  if (!actor.rollState) {
    const bob = Math.sin(now * 0.0015 + actor.home.x * 0.6 + actor.home.z) * 0.045;
    actor.group.position.y = actor.home.y + bob;
    return;
  }

  const state = actor.rollState;
  const progress = Math.min((now - state.startAt) / state.duration, 1);
  const eased = easeOutCubic(progress);
  const bounce = Math.sin(progress * Math.PI) * 1.12;
  const drift = Math.sin(progress * Math.PI) * state.sideways;
  const impactProgress = progress > 0.86 ? (progress - 0.86) / 0.14 : 0;
  const impactPulse = impactProgress > 0 ? Math.sin(impactProgress * Math.PI) * 0.08 : 0;

  actor.body.rotation.set(
    THREE.MathUtils.lerp(state.startRotation.x, state.targetRotation.x, eased),
    THREE.MathUtils.lerp(state.startRotation.y, state.targetRotation.y, eased),
    THREE.MathUtils.lerp(state.startRotation.z, state.targetRotation.z, eased)
  );
  actor.group.position.set(
    actor.home.x + drift,
    actor.home.y + bounce,
    actor.home.z + Math.sin(progress * fullTurn) * 0.12
  );
  actor.group.scale.setScalar(actor.baseScale * (1 + impactPulse));

  if (progress < 0.74 && now - state.lastPreviewAt > 86) {
    drawDieLabel(actor, rollDie(actor.sides));
    state.lastPreviewAt = now;
  }

  if (progress >= 0.74 && !state.finalLabelShown) {
    drawDieLabel(actor, state.result.value);
    state.finalLabelShown = true;
  }

  if (progress >= 1) {
    actor.body.rotation.copy(state.finalRotation);
    actor.group.position.copy(actor.home);
    actor.group.scale.setScalar(actor.baseScale);
    actor.rollState = null;
  }
}

function animateDiceRoll(results, audioReadyPromise) {
  let longestDuration = 0;
  const animationStartedAt = performance.now();

  dieActors.forEach((actor, index) => {
    const result = results[index];
    startActorRoll(actor, result, index);
    longestDuration = Math.max(longestDuration, actor.rollState.duration);
  });

  void scheduleRollAudio(dieActors, animationStartedAt, audioReadyPromise);

  return new Promise((resolve) => {
    window.setTimeout(resolve, longestDuration + 90);
  });
}

async function rollPool() {
  if (isRolling || dicePool.length === 0) {
    return;
  }

  isRolling = true;
  rollButton.disabled = true;
  clearCritBanner();
  const audioReadyPromise = unlockAudioForRoll();

  const results = dicePool.map((sides) => ({
    sides,
    value: rollDie(sides)
  }));
  const diceTotal = results.reduce((sum, result) => sum + result.value, 0);
  const modifier = getModifier();
  const grandTotal = diceTotal + modifier;
  const critical = findD20Critical(results);

  await animateDiceRoll(results, audioReadyPromise);

  writeRollLog(results, diceTotal, modifier, grandTotal);

  if (critical) {
    window.setTimeout(() => {
      showCritBanner(critical.message, critical.isFailure);
    }, 120);
  }

  isRolling = false;
  updatePoolDisplay();
}

function resizeRenderer() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  layoutDiceActors();
}

function renderScene(now) {
  dieActors.forEach((actor) => updateActorRoll(actor, now));
  renderer.render(scene, camera);
}

function getCanvasPixelStats() {
  // Debug helper for QA. It samples the WebGL canvas after a render so we can
  // confirm the Three.js scene is drawing real pixels, not a blank canvas.
  renderScene(performance.now());

  const gl = renderer.getContext();
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  const pixels = new Uint8Array(width * height * 4);
  let paintedPixels = 0;

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];

    if (alpha > 0 && red + green + blue > 24) {
      paintedPixels += 1;
    }
  }

  return {
    height,
    paintedPixels,
    width
  };
}

diceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (isRolling) {
      return;
    }

    dicePool.push(Number(button.dataset.sides));
    syncDiceActors();
    updatePoolDisplay();
  });
});

clearPoolButton.addEventListener("click", () => {
  if (isRolling) {
    return;
  }

  dicePool = [];
  syncDiceActors();
  updatePoolDisplay();
});

rollButton.addEventListener("click", rollPool);

modifierInput.addEventListener("input", () => {
  modifierTotalOutput.textContent = formatModifier(getModifier());
});

window.addEventListener("resize", resizeRenderer);
window.empyreanDiceDebug = {
  getAudioStatus() {
    return {
      bufferDuration: diceSoundBuffer ? diceSoundBuffer.duration : 0,
      contextState: audioContext ? audioContext.state : "not-created",
      lastAudioEvents,
      loadError: diceSoundLoadError ? diceSoundLoadError.message : null,
      soundLoaded: Boolean(diceSoundBuffer)
    };
  },
  getCanvasPixelStats
};

resizeRenderer();
updatePoolDisplay();
renderer.setAnimationLoop(renderScene);
