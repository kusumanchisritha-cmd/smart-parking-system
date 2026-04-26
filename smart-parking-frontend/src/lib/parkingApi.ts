// API client — connects to the Smart Parking backend.
import type { Algorithm } from "@/components/ControlPanel";
import type { AlgoResult } from "@/components/ComparisonCards";

export interface ParkResponse {
  slot: number;
  distance: number;
  timeMs: number;
}

export interface CompareResponse {
  greedy: AlgoResult;
  dp: AlgoResult;
}

export const GRID_COLS = 4;
export const GRID_ROWS = 4;

export type DestinationId =
  | "main_entrance"
  | "elevator"
  | "food_court"
  | "exit_gate";

export interface Destination {
  id: DestinationId;
  label: string;
  // Coordinates in the same grid space as slots (can be outside the grid)
  x: number;
  y: number;
}

export const DESTINATIONS: Destination[] = [
  { id: "main_entrance", label: "Main Entrance", x: 0, y: -1 },
  { id: "elevator", label: "Elevator", x: GRID_COLS, y: 1 },
  { id: "food_court", label: "Food Court", x: GRID_COLS, y: GRID_ROWS },
  { id: "exit_gate", label: "Exit Gate", x: -1, y: GRID_ROWS - 1 },
];

export function getDestination(id: DestinationId): Destination {
  return DESTINATIONS.find((d) => d.id === id) ?? DESTINATIONS[0];
}

export function slotCoords(slotId: number): { x: number; y: number } {
  const idx = slotId - 1;
  return { x: idx % GRID_COLS, y: Math.floor(idx / GRID_COLS) };
}

// Manhattan distance scaled to meters (each cell ~2.5m) — used as fallback only
const METERS_PER_CELL = 2.5;
export function walkingDistance(slotId: number, dest: Destination): number {
  const { x, y } = slotCoords(slotId);
  return (Math.abs(x - dest.x) + Math.abs(y - dest.y)) * METERS_PER_CELL;
}

// ----- Backend wiring ---------------------------------------------------

const API_URL = "http://10.2.16.47:10000";

interface RawParkResult {
  slot?: number;
  assigned_slot?: number;
  distance?: number;
  walking_distance?: number;
  time?: number;
  time_ms?: number;
  time_taken?: number;
}

function normalizeResult(raw: RawParkResult): ParkResponse {
  const slot = raw.slot ?? raw.assigned_slot ?? 0;
  const distance = raw.distance ?? raw.walking_distance ?? 0;
  const timeMs = raw.time_ms ?? raw.time ?? raw.time_taken ?? 0;
  return { slot, distance, timeMs };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

// Local fallback algorithms (used only if backend is unreachable, so the
// preview keeps working without a running server).
function pickGreedyLocal(available: number[], dest: Destination): ParkResponse {
  const start = performance.now();
  const slot = available[0];
  return {
    slot,
    distance: walkingDistance(slot, dest),
    timeMs: performance.now() - start + Math.random() * 0.5,
  };
}

function pickDPLocal(available: number[], dest: Destination): ParkResponse {
  const start = performance.now();
  let best = available[0];
  let bestD = walkingDistance(best, dest);
  for (const s of available) {
    const d = walkingDistance(s, dest);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return {
    slot: best,
    distance: bestD,
    timeMs: performance.now() - start + Math.random() * 1.2 + 0.3,
  };
}

export async function parkCar(
  _carId: string,
  algorithm: Algorithm,
  available: number[],
  destinationId: DestinationId,
): Promise<ParkResponse> {
  const dest = getDestination(destinationId);
  try {
    const raw = await postJson<RawParkResult>("/api/park", {
      destination: dest.label,
      mode: algorithm, // "greedy" | "dp"
    });
    return normalizeResult(raw);
  } catch (err) {
    console.warn("[parkingApi] /park failed, using local fallback:", err);
    if (available.length === 0) throw new Error("No slots available");
    return algorithm === "greedy"
      ? pickGreedyLocal(available, dest)
      : pickDPLocal(available, dest);
  }
}

export async function compareAlgorithms(
  _carId: string,
  available: number[],
  destinationId: DestinationId,
): Promise<CompareResponse> {
  const dest = getDestination(destinationId);
  try {
    const raw = await postJson<{
      greedy?: RawParkResult;
      dp?: RawParkResult;
      quick?: RawParkResult;
      smart?: RawParkResult;
    }>("/api/compare", { destination: dest.label });
    const greedyRaw = raw.greedy ?? raw.quick;
    const dpRaw = raw.dp ?? raw.smart;
    if (!greedyRaw || !dpRaw) {
      throw new Error("Malformed /compare response");
    }
    return {
      greedy: normalizeResult(greedyRaw),
      dp: normalizeResult(dpRaw),
    };
  } catch (err) {
    console.warn("[parkingApi] /compare failed, using local fallback:", err);
    if (available.length === 0) throw new Error("No slots available");
    return {
      greedy: pickGreedyLocal(available, dest),
      dp: pickDPLocal(available, dest),
    };
  }
}
