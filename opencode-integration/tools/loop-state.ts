import fs from "fs";
import path from "path";

const STATE_FILE = ".opencode/luffy-loop.json";

export interface LoopState {
  active: boolean;
  paused: boolean;
  iteration: number;
  maxIterations: number;
  checkpointInterval: number;
  completionPromise: string;
  prompt: string;
  startedAt: string;
  lastCheckpoint: number;
  lastIterationAt: string;
}

const DEFAULT_STATE: LoopState = {
  active: false,
  paused: false,
  iteration: 0,
  maxIterations: 10,
  checkpointInterval: 5,
  completionPromise: "DONE",
  prompt: "",
  startedAt: "",
  lastCheckpoint: 0,
  lastIterationAt: ""
};

export function loadState(): LoopState {
  try {
    const absolutePath = path.resolve(STATE_FILE);
    if (fs.existsSync(absolutePath)) {
      const content = fs.readFileSync(absolutePath, "utf-8");
      const state = JSON.parse(content);
      return { ...DEFAULT_STATE, ...state };
    }
  } catch (error) {
    // Fallback to default
  }
  return { ...DEFAULT_STATE };
}

export function saveState(state: LoopState): void {
  try {
    const absolutePath = path.resolve(STATE_FILE);
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absolutePath, JSON.stringify(state, null, 2));
  } catch (error) {
    // Silently fail - state won't persist
  }
}

export function resetState(): void {
  try {
    const absolutePath = path.resolve(STATE_FILE);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    // Silently fail
  }
}

export function checkAtCheckpoint(iteration: number, checkpointInterval: number, lastCheckpoint: number): boolean {
  return iteration > 0 && 
         iteration % checkpointInterval === 0 && 
         iteration !== lastCheckpoint;
}

export function checkCompletion(output: string, completionPromise: string): boolean {
  return output.includes(completionPromise);
}
