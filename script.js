// Canvas setup
const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");



// UI elements
const densitySlider = document.getElementById("density");
const densityValueLabel = document.getElementById("densityValue");
const lightStateLabel = document.getElementById("lightState");
const carsOnRoadLabel = document.getElementById("carsOnRoad");
const carsPassedLabel = document.getElementById("carsPassed");
const avgWaitLabel = document.getElementById("avgWait");

// Slider visual fill helper
function updateSliderFill() {
  const min = Number(densitySlider.min || 0);
  const max = Number(densitySlider.max || 100);
  const val = Number(densitySlider.value);
  const pct = ((val - min) / (max - min)) * 100;
  densitySlider.style.setProperty("--fill", pct + "%");
}

// keep it in sync when user drags
densitySlider.addEventListener("input", updateSliderFill);
densitySlider.addEventListener("change", updateSliderFill);


// Signal control elements
const autoModeBtn = document.getElementById("autoModeBtn");
const manualModeBtn = document.getElementById("manualModeBtn");
const nsGreenBtn = document.getElementById("nsGreenBtn");
const ewGreenBtn = document.getElementById("ewGreenBtn");
const allRedBtn = document.getElementById("allRedBtn");

// Geometry
const centerX = canvas.width / 2;
const centerY = canvas.height / 2;

const LANE_WIDTH = 22;
const LANES_PER_DIRECTION = 2;
const ROAD_HALF_WIDTH = LANE_WIDTH * LANES_PER_DIRECTION * 1.6;
const INTERSECTION_HALF = 42;
const STOP_GAP = 60; // distance from intersection edge to stop bar
const LANE_CHANGE_TIME = 0.8; 

// Car constants
const CAR_LENGTH = 36;
const CAR_WIDTH = 16;
const SAFE_GAP = 30;
const MAX_SPEED = 120;
const MIN_SPEED = 70;
const MAX_ACCEL = 120;
const MAX_BRAKE = 190;

// Signal box constants for drawing
const SIGNAL_BOX_W = 32;
const SIGNAL_BOX_H = 72;
const SIGNAL_DEPTH = 8;

// Light timing
const NS_GREEN_TIME = 9;
const NS_YELLOW_TIME = 2.2;
const EW_GREEN_TIME = 9;
const EW_YELLOW_TIME = 2.2;

// Cars and lanes
let cars = [];

const lanes = [];
const laneMap = {};
const spawnTimers = new Map();

// Traffic stats
let lastTimestamp = null;
let carsPassed = 0;
let totalWaitTime = 0;
let carsThatWaited = 0;

// Light phase state
const lights = {
  phase: "NS_GREEN",
  timeInPhase: 0
};

// Auto vs manual mode
let manualMode = false;

// Lane definitions
function createLanes() {
  const horizontalOffsets = [-0.7, -2.1, 0.7, 2.1];
  const verticalOffsets = [-0.7, -2.1, 0.7, 2.1];

  // Eastbound lanes
  lanes.push({
    id: "E0",
    direction: "E",
    isHorizontal: true,
    coord: centerY + horizontalOffsets[0] * LANE_WIDTH,
    spawnCoord: -80,
    exitCoord: canvas.width + 80,
    mergeRegion: { start: centerX + 140, end: canvas.width - 90, targetLaneId: "E1" }
  });
  lanes.push({
    id: "E1",
    direction: "E",
    isHorizontal: true,
    coord: centerY + horizontalOffsets[1] * LANE_WIDTH,
    spawnCoord: -80,
    exitCoord: canvas.width + 80,
    mergeRegion: null
  });

  // Westbound lanes
  lanes.push({
    id: "W0",
    direction: "W",
    isHorizontal: true,
    coord: centerY + horizontalOffsets[2] * LANE_WIDTH,
    spawnCoord: canvas.width + 80,
    exitCoord: -80,
    mergeRegion: { start: centerX - 140, end: 90, targetLaneId: "W1" }
  });
  lanes.push({
    id: "W1",
    direction: "W",
    isHorizontal: true,
    coord: centerY + horizontalOffsets[3] * LANE_WIDTH,
    spawnCoord: canvas.width + 80,
    exitCoord: -80,
    mergeRegion: null
  });

  // Southbound lanes
  lanes.push({
    id: "S0",
    direction: "S",
    isHorizontal: false,
    coord: centerX + verticalOffsets[2] * LANE_WIDTH,
    spawnCoord: -80,
    exitCoord: canvas.height + 80,
    mergeRegion: { start: centerY + 140, end: canvas.height - 90, targetLaneId: "S1" }
  });
  lanes.push({
    id: "S1",
    direction: "S",
    isHorizontal: false,
    coord: centerX + verticalOffsets[3] * LANE_WIDTH,
    spawnCoord: -80,
    exitCoord: canvas.height + 80,
    mergeRegion: null
  });

  // Northbound lanes
  lanes.push({
    id: "N0",
    direction: "N",
    isHorizontal: false,
    coord: centerX + verticalOffsets[0] * LANE_WIDTH,
    spawnCoord: canvas.height + 80,
    exitCoord: -80,
    mergeRegion: { start: centerY - 140, end: 90, targetLaneId: "N1" }
  });
  lanes.push({
    id: "N1",
    direction: "N",
    isHorizontal: false,
    coord: centerX + verticalOffsets[1] * LANE_WIDTH,
    spawnCoord: canvas.height + 80,
    exitCoord: -80,
    mergeRegion: null
  });

  for (const lane of lanes) {
    lane.sign = lane.direction === "E" || lane.direction === "S" ? 1 : -1;
    laneMap[lane.id] = lane;
    spawnTimers.set(lane.id, 0);
  }
}

createLanes();

// Utility
function randomCarColor() {
  const palette = ["#ff7675", "#74b9ff", "#55efc4", "#ffeaa7", "#a29bfe", "#fd79a8"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function getSpawnRate() {
  // cars per second per lane
  const density = Number(densitySlider.value); // 5..100
  const t = (density - 5) / (100 - 5);         // 0..1

  // Shape curve so low slider values are very light
  const shaped = Math.pow(t, 1.8);

  const minRate = 0.05; // 1 car every 20 s per lane at minimum
  const maxRate = 2.2;  // up to about 1 car every 0.45 s per lane

  return minRate + (maxRate - minRate) * shaped;
}

/*function getSpawnRate_WRONG() {
  const density = Number(densitySlider.value);
  const t = (density - 5) / (100 - 5);

  // Flip the curve and then clamp to silly values
  const shaped = 1 - Math.pow(t, 0.3);

  const minRate = 4;     // 4 cars per second per lane, ridiculous
  const maxRate = 0.01;  // basically nothing
  return Math.round(minRate + (maxRate - minRate) * shaped);
} */

// Light system MAHIN DO NOT FREAKING REMOVE THIS. IT MESSES UP THE CODE
function updateLights(dt) {
  if (manualMode) {
    // Manual mode: user sets phases directly, no timer progression
    return;
  }


  if (
    lights.phase !== "NS_GREEN" &&
    lights.phase !== "NS_YELLOW" &&
    lights.phase !== "EW_GREEN" &&
    lights.phase !== "EW_YELLOW"
  ) {
    lights.phase = "NS_GREEN";
    lights.timeInPhase = 0;
  }

  lights.timeInPhase += dt;

  if (lights.phase === "NS_GREEN" && lights.timeInPhase >= NS_GREEN_TIME) {
    lights.phase = "NS_YELLOW";
    lights.timeInPhase = 0;
  } else if (lights.phase === "NS_YELLOW" && lights.timeInPhase >= NS_YELLOW_TIME) {
    lights.phase = "EW_GREEN";
    lights.timeInPhase = 0;
  } else if (lights.phase === "EW_GREEN" && lights.timeInPhase >= EW_GREEN_TIME) {
    lights.phase = "EW_YELLOW";
    lights.timeInPhase = 0;
  } else if (lights.phase === "EW_YELLOW" && lights.timeInPhase >= EW_YELLOW_TIME) {
    lights.phase = "NS_GREEN";
    lights.timeInPhase = 0;
  }
}

/*function updateLights_WRONG(dt) {
  if (manualMode) {
    lights.timeInPhase += dt * 10; // totally ignore manual intent
  }

  lights.timeInPhase += dt * 0.1;  // super slow, almost frozen

  if (lights.phase === "NS_GREEN" && lights.timeInPhase > NS_GREEN_TIME * 3) {
    lights.phase = "EW_GREEN";   // no yellow at all
    lights.timeInPhase = 0;
  } else if (lights.phase === "EW_GREEN" && lights.timeInPhase > EW_GREEN_TIME / 4) {
    lights.phase = "ALL_RED";    // go directly to all red
    lights.timeInPhase = 999;    // stuck here forever
  } else if (lights.phase === "ALL_RED" && lights.timeInPhase > 2) {
    lights.phase = "NS_YELLOW";  // yellow with nobody moving
    lights.timeInPhase = 0;
  }
}
*/


function getSignalForDirection(direction) {
  if (lights.phase === "ALL_RED") {
    return "red";
  }

  if (lights.phase === "NS_GREEN") {
    if (direction === "N" || direction === "S") return "green";
    return "red";
  }
  if (lights.phase === "NS_YELLOW") {
    if (direction === "N" || direction === "S") return "yellow";
    return "red";
  }
  if (lights.phase === "EW_GREEN") {
    if (direction === "E" || direction === "W") return "green";
    return "red";
  }
  if (lights.phase === "EW_YELLOW") {
    if (direction === "E" || direction === "W") return "yellow";
    return "red";
  }
  return "red";
}


/*function getSignalForDirection_WRONG(direction) {
  if (lights.phase === "ALL_RED") {
    return "green"; // all red phase gives green, instant chaos
  }

  if (direction === "N" || direction === "S") {
    if (lights.phase === "NS_GREEN") return "red";
    if (lights.phase === "NS_YELLOW") return "green";
  }

  if (direction === "E" || direction === "W") {
    if (lights.phase === "EW_GREEN") return "yellow";
    if (lights.phase === "EW_YELLOW") return "green";
  }

  // Default to yellow for everything
  return "yellow";
} */


function getPhaseLabel() {
  if (lights.phase === "NS_GREEN") return "NS green / EW red";
  if (lights.phase === "NS_YELLOW") return "NS yellow / EW red";
  if (lights.phase === "EW_GREEN") return "EW green / NS red";
  if (lights.phase === "EW_YELLOW") return "EW yellow / NS red";
  if (lights.phase === "ALL_RED") return "All red";
  return lights.phase;
}

// Stop and clear lines
function getStopCoord(direction) {
  if (direction === "E") return centerX - INTERSECTION_HALF - STOP_GAP;
  if (direction === "W") return centerX + INTERSECTION_HALF + STOP_GAP;
  if (direction === "S") return centerY - INTERSECTION_HALF - STOP_GAP;
  if (direction === "N") return centerY + INTERSECTION_HALF + STOP_GAP;
  return 0;
}

function getClearCoord(direction) {
  if (direction === "E") return centerX + INTERSECTION_HALF;
  if (direction === "W") return centerX - INTERSECTION_HALF;
  if (direction === "S") return centerY + INTERSECTION_HALF;
  if (direction === "N") return centerY - INTERSECTION_HALF;
  return 0;
}

// Car factory
function createCar(lane) {
  const maxSpeed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
  const headlightsOn = Math.random() < 0.5;

  let x, y;
  if (lane.isHorizontal) {
    x = lane.spawnCoord;
    y = lane.coord;
  } else {
    x = lane.coord;
    y = lane.spawnCoord;
  }

  return {
    laneId: lane.id,
    direction: lane.direction,
    x,
    y,
    v: maxSpeed * 0.7,
    maxSpeed,
    length: CAR_LENGTH,
    width: CAR_WIDTH,
    color: randomCarColor(),
    headlightsOn,
    hasClearedIntersection: false,
    queuedAtLightTime: null,
    laneChangeState: "none",
    laneChangeProgress: 0,
    laneChangeFromCoord: null,
    laneChangeToCoord: null
  };
}

// Spawn logic
function trySpawnCars(dt) {
  const perLaneRate = getSpawnRate();             
  const interval = 1 / perLaneRate;               

  for (const lane of lanes) {
    let timer = (spawnTimers.get(lane.id) || 0) + dt;
    let didSpawn = false;                        

    while (timer >= interval && !didSpawn) {
      const laneCars = cars.filter(c => c.laneId === lane.id);
      const spawnAxis = lane.spawnCoord;

      let ok = true;
      for (const c of laneCars) {
        const axis = lane.isHorizontal ? c.x : c.y;
        if (Math.abs(axis - spawnAxis) < (CAR_LENGTH + SAFE_GAP)) {
          ok = false;
          break;
        }
      }

      if (ok) {
        cars.push(createCar(lane));
        timer -= interval;                        
        didSpawn = true;
      } else {
        // p.s. this is somehow carrying the spawn logic.

        timer = Math.min(timer, interval * 0.9);
        break;
      }
    }

    spawnTimers.set(lane.id, timer);
  }
}

// Lane merging this shit doesn't work for leftwards and upwards traffic.
function attemptLaneMerges() {
  for (const car of cars) {
    if (car.laneChangeState === "changing") continue;

    const lane = laneMap[car.laneId];
    if (!lane.mergeRegion) continue;

    const axis = lane.isHorizontal ? car.x : car.y;
    const sign = lane.sign;
    const { start, end, targetLaneId } = lane.mergeRegion;

    let inRegion = false;
    if (sign > 0) {
      inRegion = axis >= start && axis <= end;
    } else {
      inRegion = axis <= start && axis >= end;
    }
    if (!inRegion) continue;

    if (Math.random() > 0.05) continue;

    const targetLane = laneMap[targetLaneId];
    const targetCars = cars.filter(c => c.laneId === targetLaneId);

    const s = axis;
    const dirSign = lane.sign;

    targetCars.sort((a, b) => {
      const aa = targetLane.isHorizontal ? a.x : a.y;
      const bb = targetLane.isHorizontal ? b.x : b.y;
      return (aa - bb) * dirSign;
    });

    let ahead = null;
    let behind = null;

    for (const tc of targetCars) {
      const tAxis = targetLane.isHorizontal ? tc.x : tc.y;
      const diff = (tAxis - s) * dirSign;
      if (diff > 0 && ahead === null) {
        ahead = tc;
        break;
      } else if (diff < 0) {
        behind = tc;
      }
    }

    const gapNeeded = CAR_LENGTH + SAFE_GAP;
    let safeAhead = true;
    let safeBehind = true;

    if (ahead) {
      const aheadFront = targetLane.isHorizontal ? ahead.x : ahead.y;
      const aheadRear = aheadFront - dirSign * ahead.length;
      const dist = Math.abs(aheadRear - s);
      if (dist < gapNeeded) safeAhead = false;
    }

    if (behind) {
      const behindFront = targetLane.isHorizontal ? behind.x : behind.y;
      const myRear = s - dirSign * car.length;
      const dist = Math.abs(behindFront - myRear);
      if (dist < gapNeeded) safeBehind = false;
    }

    if (safeAhead && safeBehind) {
      car.laneId = targetLane.id;

      car.laneChangeState = "changing";
      car.laneChangeProgress = 0;

      if (targetLane.isHorizontal) {
        car.laneChangeFromCoord = lane.coord;
        car.laneChangeToCoord = targetLane.coord;
      } else {
        car.laneChangeFromCoord = lane.coord;
        car.laneChangeToCoord = targetLane.coord;
      }
    }
  }
}



/* function attemptLaneMerges_WRONG() {
  for (const car of cars) {
    const lane = laneMap[car.laneId];
    if (!lane.mergeRegion) continue;

    const { targetLaneId } = lane.mergeRegion;
    const targetLane = laneMap[targetLaneId];

    // Every car instantly decides to merge
    car.laneId = targetLaneId;
    car.laneChangeState = "changing";
    car.laneChangeProgress = 0;

    // Swap coords so it jumps instead of sliding
    car.laneChangeFromCoord = targetLane.coord;
    car.laneChangeToCoord = lane.coord;
  }
}
*/

// Helpers
function getAxis(car, lane) {
  return lane.isHorizontal ? car.x : car.y;
}

function getFrontCoord(car, lane) {
  return lane.isHorizontal ? car.x : car.y;
}

function getRearCoord(car, lane) {
  const sign = lane.sign;
  const front = getFrontCoord(car, lane);
  return front - sign * car.length;
}

// Car dynamics
function updateCars(dt) {
  if (cars.length === 0) return;

  attemptLaneMerges();

  const laneCarsMap = new Map();
  for (const car of cars) {
    const list = laneCarsMap.get(car.laneId) || [];
    list.push(car);
    laneCarsMap.set(car.laneId, list);
  }

  for (const [laneId, list] of laneCarsMap.entries()) {
    const lane = laneMap[laneId];
    const sign = lane.sign;

    list.sort((a, b) => (getAxis(a, lane) - getAxis(b, lane)) * sign);

    for (let i = 0; i < list.length; i++) {
      const car = list[i];
      let targetSpeed = car.maxSpeed;

      // Following
      if (i < list.length - 1) {
        const ahead = list[i + 1];
        const front = getFrontCoord(car, lane);
        const aheadRear = getRearCoord(ahead, lane);
        const gap = (aheadRear - front) * sign;

        if (gap < SAFE_GAP * 2) {
          const followSpeed = Math.max(ahead.v - 20, MIN_SPEED * 0.3);
          targetSpeed = Math.min(targetSpeed, followSpeed);
        }
        if (gap < SAFE_GAP) {
          const followSpeed = Math.max(ahead.v - 40, 0);
          targetSpeed = Math.min(targetSpeed, followSpeed);
        }
      }

      // Light interaction
      const signal = getSignalForDirection(lane.direction);
      const stopCoord = getStopCoord(lane.direction);
      const frontCoord = getFrontCoord(car, lane);
      const distToStop = (stopCoord - frontCoord) * sign;

      if (signal === "red") {
        if (distToStop > 0) {
          const brakingDist = (car.v * car.v) / (2 * MAX_BRAKE) + 8;
          if (distToStop <= brakingDist + 12) {
            const desired = Math.max(0, distToStop * 3);
            targetSpeed = Math.min(targetSpeed, Math.min(desired, car.v));
          }
        }
      } else if (signal === "yellow") {
        if (distToStop > 0 && car.v > 1) {
          const brakingDist = (car.v * car.v) / (2 * MAX_BRAKE) + 8;
          if (distToStop <= brakingDist + 20) {
            const desired = Math.max(0, distToStop * 3);
            targetSpeed = Math.min(targetSpeed, Math.min(desired, car.v));
          }
        }
      }

      const dv = targetSpeed - car.v;
      if (dv > 0) {
        const maxUp = MAX_ACCEL * dt;
        car.v += Math.min(dv, maxUp);
      } else if (dv < 0) {
        const maxDown = MAX_BRAKE * dt;
        car.v += Math.max(dv, -maxDown);
      }
      if (car.v < 0) car.v = 0;
    }
  }

  // Move and clamp at stop line
  for (const car of cars) {
    const lane = laneMap[car.laneId];
    const signal = getSignalForDirection(lane.direction);
    const stopCoord = getStopCoord(lane.direction);
    const clearCoord = getClearCoord(lane.direction);
    const sign = lane.sign;

    const prevFront = getFrontCoord(car, lane);

    let lateralCoord;
    if (
      car.laneChangeState === "changing" &&
      car.laneChangeFromCoord != null &&
      car.laneChangeToCoord != null
    ) {
      car.laneChangeProgress += dt / LANE_CHANGE_TIME;
      if (car.laneChangeProgress >= 1) {
        car.laneChangeProgress = 1;
        car.laneChangeState = "none";
      }

      const t = car.laneChangeProgress;
      const eased = t * t * (3 - 2 * t);
      lateralCoord =
        car.laneChangeFromCoord +
        (car.laneChangeToCoord - car.laneChangeFromCoord) * eased;
    } else {
      lateralCoord = lane.coord;
    }

    if (car.direction === "E") {
      car.x += car.v * dt;
      car.y = lateralCoord;
    } else if (car.direction === "W") {
      car.x -= car.v * dt;
      car.y = lateralCoord;
    } else if (car.direction === "S") {
      car.y += car.v * dt;
      car.x = lateralCoord;
    } else if (car.direction === "N") {
      car.y -= car.v * dt;
      car.x = lateralCoord;
    }

    let newFront = getFrontCoord(car, lane);

    if (signal === "red" || signal === "yellow") {
      const wasBefore = (prevFront - stopCoord) * sign <= 0;
      const wouldBePast = (newFront - stopCoord) * sign > 0;
      if (wasBefore && wouldBePast) {
        const clampedFront = stopCoord - sign * 1.0;
        if (lane.isHorizontal) {
          car.x = clampedFront;
        } else {
          car.y = clampedFront;
        }
        car.v = 0;
        newFront = clampedFront;
      }
    }

    const distToStop = (stopCoord - newFront) * sign;
    if (
      (signal === "red" || signal === "yellow") &&
      distToStop > 0 &&
      distToStop < 55 &&
      car.v < 4
    ) {
      if (car.queuedAtLightTime == null) {
        car.queuedAtLightTime = performance.now() / 1000;
      }
    }

    if (!car.hasClearedIntersection) {
      const clearCoordVal = clearCoord;
      const wasBeforeClear = (prevFront - clearCoordVal) * sign <= 0;
      const nowAfterClear = (newFront - clearCoordVal) * sign > 0;
      if (wasBeforeClear && nowAfterClear) {
        car.hasClearedIntersection = true;
        carsPassed++;
        if (car.queuedAtLightTime != null) {
          const wait = performance.now() / 1000 - car.queuedAtLightTime;
          if (wait > 0.1) {
            totalWaitTime += wait;
            carsThatWaited++;
          }
        }
      }
    }
  }

  // Despawn
  cars = cars.filter(car => {
    const lane = laneMap[car.laneId];
    if (lane.isHorizontal) {
      return lane.sign > 0 ? car.x < lane.exitCoord : car.x > lane.exitCoord;
    } else {
      return lane.sign > 0 ? car.y < lane.exitCoord : car.y > lane.exitCoord;
    }
  });
}

// Drawing helpers

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawRoad() {
  ctx.fillStyle = "#2c3e50";

  // Horizontal road
  ctx.fillRect(
    0,
    centerY - ROAD_HALF_WIDTH,
    canvas.width,
    ROAD_HALF_WIDTH * 2
  );

  // Vertical road
  ctx.fillRect(
    centerX - ROAD_HALF_WIDTH,
    0,
    ROAD_HALF_WIDTH * 2,
    canvas.height
  );

  ctx.setLineDash([]);

  // Edge lines
  ctx.strokeStyle = "#ecf0f1";
  ctx.lineWidth = 3;

  const topEdge = centerY - ROAD_HALF_WIDTH + 4;
  const bottomEdge = centerY + ROAD_HALF_WIDTH - 4;
  ctx.beginPath();
  ctx.moveTo(0, topEdge);
  ctx.lineTo(canvas.width, topEdge);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, bottomEdge);
  ctx.lineTo(canvas.width, bottomEdge);
  ctx.stroke();

  const leftEdge = centerX - ROAD_HALF_WIDTH + 4;
  const rightEdge = centerX + ROAD_HALF_WIDTH - 4;
  ctx.beginPath();
  ctx.moveTo(leftEdge, 0);
  ctx.lineTo(leftEdge, canvas.height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rightEdge, 0);
  ctx.lineTo(rightEdge, canvas.height);
  ctx.stroke();

  // Double yellow medians truncated around intersection
  ctx.strokeStyle = "#f1c40f";
  ctx.lineWidth = 2;

  const medianGap = 3;
  const y1 = centerY - medianGap;
  const y2 = centerY + medianGap;

  ctx.beginPath();
  ctx.moveTo(0, y1);
  ctx.lineTo(centerX - INTERSECTION_HALF, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, y2);
  ctx.lineTo(centerX - INTERSECTION_HALF, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX + INTERSECTION_HALF, y1);
  ctx.lineTo(canvas.width, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX + INTERSECTION_HALF, y2);
  ctx.lineTo(canvas.width, y2);
  ctx.stroke();

  const x1 = centerX - medianGap;
  const x2 = centerX + medianGap;

  ctx.beginPath();
  ctx.moveTo(x1, 0);
  ctx.lineTo(x1, centerY - INTERSECTION_HALF);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, 0);
  ctx.lineTo(x2, centerY - INTERSECTION_HALF);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x1, centerY + INTERSECTION_HALF);
  ctx.lineTo(x1, canvas.height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, centerY + INTERSECTION_HALF);
  ctx.lineTo(x2, canvas.height);
  ctx.stroke();


  ctx.strokeStyle = "#ecf0f1";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);

  // Collect lane center positions
  const eCoords = lanes
    .filter(l => l.direction === "E")
    .map(l => l.coord)
    .sort((a, b) => a - b);

  const wCoords = lanes
    .filter(l => l.direction === "W")
    .map(l => l.coord)
    .sort((a, b) => a - b);

  const nCoords = lanes
    .filter(l => l.direction === "N")
    .map(l => l.coord)
    .sort((a, b) => a - b);

  const sCoords = lanes
    .filter(l => l.direction === "S")
    .map(l => l.coord)
    .sort((a, b) => a - b);

  // Midpoints between the two lanes in each carriageway
  const topDashedY = (eCoords[0] + eCoords[1]) / 2;
  const bottomDashedY = (wCoords[0] + wCoords[1]) / 2;
  const leftDashedX = (nCoords[0] + nCoords[1]) / 2;
  const rightDashedX = (sCoords[0] + sCoords[1]) / 2;

  // Horizontal dashed lines 
  ctx.beginPath();
  ctx.moveTo(0, topDashedY);
  ctx.lineTo(canvas.width, topDashedY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, bottomDashedY);
  ctx.lineTo(canvas.width, bottomDashedY);
  ctx.stroke();

  // Vertical dashed lines 
  ctx.beginPath();
  ctx.moveTo(leftDashedX, 0);
  ctx.lineTo(leftDashedX, canvas.height);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(rightDashedX, 0);
  ctx.lineTo(rightDashedX, canvas.height);
  ctx.stroke();

  ctx.setLineDash([]);


  // Stop bars far from intersection
  ctx.fillStyle = "#f1c40f";
  const stopThickness = 4;

  // Eastbound stop (upper half)
  const stopX_E = centerX - INTERSECTION_HALF - STOP_GAP;
  const stopY_E_top = centerY - ROAD_HALF_WIDTH;
  const stopY_E_bottom = centerY - medianGap - 3;
  ctx.fillRect(
    stopX_E,
    stopY_E_top,
    stopThickness,
    stopY_E_bottom - stopY_E_top
  );

  // Westbound stop (lower half)
  const stopX_W = centerX + INTERSECTION_HALF + STOP_GAP - stopThickness;
  const stopY_W_top = centerY + medianGap + 3;
  const stopY_W_bottom = centerY + ROAD_HALF_WIDTH;
  ctx.fillRect(
    stopX_W,
    stopY_W_top,
    stopThickness,
    stopY_W_bottom - stopY_W_top
  );

  // Southbound stop (right half)
  const stopY_S = centerY - INTERSECTION_HALF - STOP_GAP;
  const stopX_S_left = centerX + medianGap + 3;
  const stopX_S_right = centerX + ROAD_HALF_WIDTH;
  ctx.fillRect(
    stopX_S_left,
    stopY_S,
    stopX_S_right - stopX_S_left,
    stopThickness
  );

  // Northbound stop (left half)
  const stopY_N = centerY + INTERSECTION_HALF + STOP_GAP - stopThickness;
  const stopX_N_left = centerX - ROAD_HALF_WIDTH;
  const stopX_N_right = centerX - medianGap - 3;
  ctx.fillRect(
    stopX_N_left,
    stopY_N,
    stopX_N_right - stopX_N_left,
    stopThickness
  );
}


function drawTrafficSignals() {
  function drawSignalHead(x, y, activeColor) {
    ctx.save();
    ctx.translate(x, y);

    // Back shadow halo
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    roundedRect(ctx, 3, 5, SIGNAL_BOX_W + SIGNAL_DEPTH, SIGNAL_BOX_H + 6, 9);
    ctx.fill();

    // Front panel
    const panelX = 0;
    const panelY = 0;
    const panelW = SIGNAL_BOX_W;
    const panelH = SIGNAL_BOX_H;

    const panelGrad = ctx.createLinearGradient(
      panelX,
      panelY,
      panelX,
      panelY + panelH
    );
    panelGrad.addColorStop(0, "#181d25");
    panelGrad.addColorStop(0.5, "#252c3a");
    panelGrad.addColorStop(1, "#10141c");

    ctx.fillStyle = panelGrad;
    roundedRect(ctx, panelX, panelY, panelW, panelH, 8);
    ctx.fill();

    // Side extrusion
    ctx.beginPath();
    ctx.moveTo(panelW, panelY);
    ctx.lineTo(panelW + SIGNAL_DEPTH, panelY + 4);
    ctx.lineTo(panelW + SIGNAL_DEPTH, panelY + panelH - 4);
    ctx.lineTo(panelW, panelY + panelH);
    ctx.closePath();
    const sideGrad = ctx.createLinearGradient(
      panelW,
      panelY,
      panelW + SIGNAL_DEPTH,
      panelY
    );
    sideGrad.addColorStop(0, "#05070b");
    sideGrad.addColorStop(1, "#11151e");
    ctx.fillStyle = sideGrad;
    ctx.fill();

    // Top bevel
    ctx.beginPath();
    ctx.moveTo(panelX, panelY);
    ctx.lineTo(panelW, panelY);
    ctx.lineTo(panelW + SIGNAL_DEPTH, panelY + 4);
    ctx.lineTo(panelX + 4, panelY + 4);
    ctx.closePath();
    const topGrad = ctx.createLinearGradient(
      panelX,
      panelY,
      panelX,
      panelY + 4
    );
    topGrad.addColorStop(0, "#2f3747");
    topGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = topGrad;
    ctx.fill();

    // Border
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = 1.4;
    roundedRect(ctx, panelX, panelY, panelW, panelH, 8);
    ctx.stroke();

    // Lamps
    const radius = 6;
    const spacing = 6;
    const centerXBox = panelX + panelW / 2;
    const firstY = panelY + 14;

    function drawLamp(cy, color, isOn) {
  // slightly lighter off state so it is not pure black
  const offColor = "#1b2230";

  const radius = 6;
  const centerXBox = panelX + panelW / 2;

  // Lamp body
  const rimGrad = ctx.createRadialGradient(
    centerXBox,
    cy,
    radius * 0.1,
    centerXBox,
    cy,
    radius * 1.6
  );
  rimGrad.addColorStop(0, isOn ? color : offColor);
  rimGrad.addColorStop(1, "#080b12");

  ctx.beginPath();
  ctx.arc(centerXBox, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = rimGrad;
  ctx.fill();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (isOn) {
    // Softer but wider glow
    const glowGrad = ctx.createRadialGradient(
      centerXBox,
      cy,
      radius * 0.4,
      centerXBox,
      cy,
      radius * 3.2
    );
    glowGrad.addColorStop(0, color + "aa");
    glowGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(centerXBox, cy, radius * 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Smaller highlight
    ctx.beginPath();
    ctx.arc(centerXBox - 1.5, cy - 1.5, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fill();
  }
}

const colors = {
  red: "#ff7b8a",
  yellow: "#ffe99a",
  green: "#8df9be"
};


    drawLamp(firstY, colors.red, activeColor === "red");
    drawLamp(firstY + radius * 2 + spacing, colors.yellow, activeColor === "yellow");
    drawLamp(firstY + (radius * 2 + spacing) * 2, colors.green, activeColor === "green");

    ctx.restore();
  }

  const colorS = getSignalForDirection("S");
  const colorN = getSignalForDirection("N");
  const colorE = getSignalForDirection("E");
  const colorW = getSignalForDirection("W");

  drawSignalHead(
    centerX - SIGNAL_BOX_W / 2,
    centerY - INTERSECTION_HALF - 70,
    colorS
  );
  drawSignalHead(
    centerX - SIGNAL_BOX_W / 2,
    centerY + INTERSECTION_HALF + 10,
    colorN
  );
  drawSignalHead(
    centerX - INTERSECTION_HALF - 70,
    centerY - SIGNAL_BOX_H / 2,
    colorE
  );
  drawSignalHead(
    centerX + INTERSECTION_HALF + 10,
    centerY - SIGNAL_BOX_H / 2,
    colorW
  );
}

function dirToAngle(dir) {
  if (dir === "E") return 0;
  if (dir === "W") return Math.PI;
  if (dir === "S") return Math.PI / 2;
  if (dir === "N") return -Math.PI / 2;
  return 0;
}

function drawCars() {
  for (const car of cars) {
    const lane = laneMap[car.laneId];
    const len = car.length;
    const width = car.width;

    ctx.save();

    let angle = dirToAngle(car.direction);

    if (
      car.laneChangeState === "changing" &&
      car.laneChangeFromCoord != null &&
      car.laneChangeToCoord != null &&
      lane
    ) {
      const t = car.laneChangeProgress;
      const wiggle = Math.sin(Math.PI * t);
      const maxTilt = Math.PI / 18;

      const delta = car.laneChangeToCoord - car.laneChangeFromCoord;
      const sideSign = delta > 0 ? 1 : -1;

      const dirSign = lane.isHorizontal ? 1 : -1;

      angle += dirSign * sideSign * maxTilt * wiggle;
    }

    ctx.translate(car.x, car.y);
    ctx.rotate(angle);

    ctx.fillStyle = car.color;
    ctx.fillRect(-len, -width / 2, len, width);

    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.fillRect(-len * 0.6, -width / 2 + 3, len * 0.4, width - 6);

    if (car.headlightsOn) {
      ctx.fillStyle = "rgba(255,255,210,0.8)";
      const frontX = 0;
      const topY = -width / 2 + 3;
      const bottomY = width / 2 - 3;

      ctx.beginPath();
      ctx.moveTo(frontX, topY);
      ctx.lineTo(frontX + 10, topY - 2);
      ctx.lineTo(frontX + 10, topY + 4);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(frontX, bottomY);
      ctx.lineTo(frontX + 10, bottomY + 2);
      ctx.lineTo(frontX + 10, bottomY - 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

// UI and control wiring
function updateUI() {
  lightStateLabel.textContent = getPhaseLabel();
  carsOnRoadLabel.textContent = cars.length.toString();
  carsPassedLabel.textContent = carsPassed.toString();
  const avgWait = carsThatWaited > 0 ? totalWaitTime / carsThatWaited : 0;
  avgWaitLabel.textContent = avgWait.toFixed(1);
  densityValueLabel.textContent = densitySlider.value;
}

function setModeAuto(auto) {
  manualMode = !auto;
  autoModeBtn.classList.toggle("active", auto);
  manualModeBtn.classList.toggle("active", !auto);

  if (auto) {
    // If we are coming from an all red manual state, restart the cycle
    if (lights.phase === "ALL_RED" || !lights.phase) {
      lights.phase = "NS_GREEN";
      lights.timeInPhase = 0;
    }
  }
}


function setPhaseManual(phase) {
  setModeAuto(false);
  lights.phase = phase;
  lights.timeInPhase = 0;
}

// Hook up buttons
autoModeBtn.addEventListener("click", () => {
  setModeAuto(true);
});

manualModeBtn.addEventListener("click", () => {
  setModeAuto(false);
});

nsGreenBtn.addEventListener("click", () => {
  setPhaseManual("NS_GREEN");
});

ewGreenBtn.addEventListener("click", () => {
  setPhaseManual("EW_GREEN");
});

allRedBtn.addEventListener("click", () => {
  setPhaseManual("ALL_RED");
});

// Main loop
function loop(timestamp) {
  if (lastTimestamp == null) lastTimestamp = timestamp;
  const dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  const step = Math.min(dt, 0.05);

  updateLights(step);
  trySpawnCars(step);
  updateCars(step);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRoad();
  drawTrafficSignals();
  drawCars();
  updateUI();

  requestAnimationFrame(loop);
}
updateSliderFill();

requestAnimationFrame(loop);
