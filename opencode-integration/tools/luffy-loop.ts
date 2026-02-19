import { tool } from "@opencode-ai/plugin"
import fs from "fs";
import path from "path";

const STATE_FILE = path.join(
  process.env.HOME || "~",
  ".config/opencode/.state/luffy-loop.json"
);

interface LoopState {
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

function loadState(): LoopState {
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

function saveState(state: LoopState): void {
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

function resetState(): void {
  try {
    const absolutePath = path.resolve(STATE_FILE);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    // Silently fail
  }
}

export default tool({
  description: `🦓 Luffy Loop - Autonomous executor with checkpoint reviews.

**Commands:**
- start: Begin autonomous loop with checkpoint reviews
- status: Show current progress
- iterate: Advance one iteration with checkpoint check
- pause: Pause at checkpoint for Oracle review
- resume: Continue after review (requires Oracle approval)
- terminate: Stop completely

**Features:**
- Checkpoint-based progress (configurable intervals)
- State persistence across restarts
- Auto-pause at checkpoints
- Oracle controls: continue/pause/terminate at every checkpoint
- Completion detection for <promise>DONE</promise>

**Workflow:**
1. @luffy_loop command=start prompt="..."
2. @luffy_loop command=iterate (advances iterations)
3. At checkpoint: Loop auto-pauses, Oracle reviews
4. Oracle DECIDES: continue/pause/terminate
5. User can override Oracle's decision`,

  args: {
    command: tool.schema.enum(["start", "status", "iterate", "pause", "resume", "terminate"])
      .describe("Command: start, status, iterate, pause, resume, terminate"),
    prompt: tool.schema.string()
      .describe("Task prompt (for start command)"),
    maxIterations: tool.schema.number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum iterations (default: 10)"),
    checkpointInterval: tool.schema.number()
      .min(1)
      .max(50)
      .default(5)
      .describe("Iterations before checkpoint review (default: 5)"),
    completionPromise: tool.schema.string()
      .default("DONE")
      .describe("Completion signal (default: DONE)")
  },

  async execute(args, context) {
    const { command, prompt, maxIterations, checkpointInterval, completionPromise } = args;

    switch (command) {
      case "start":
        return await this.startLoop(prompt, maxIterations, checkpointInterval, completionPromise);
      case "status":
        return await this.status();
      case "iterate":
        return await this.iterate();
      case "pause":
        return await this.pause();
      case "resume":
        return await this.resume();
      case "terminate":
        return await this.terminate();
      default:
        return `Unknown command: ${command}`;
    }
  },

  async startLoop(prompt: string, maxIterations: number, checkpointInterval: number, completionPromise: string) {
    const state = loadState();
    
    if (state.active) {
      return `**Loop already active**

Task: ${state.prompt}
Iteration: ${state.iteration}/${state.maxIterations}
Status: ${state.paused ? "Paused" : "Running"}

Use @luffy_loop command=status to check progress, or terminate first.`;
    }

    const newState: LoopState = {
      active: true,
      paused: false,
      iteration: 0,
      maxIterations,
      checkpointInterval,
      completionPromise,
      prompt,
      startedAt: new Date().toISOString(),
      lastCheckpoint: 0,
      lastIterationAt: ""
    };
    
    saveState(newState);

    return `**🦓 Luffy Loop Started**

**Task:** ${prompt}
**Max Iterations:** ${maxIterations}
**Checkpoint:** Every ${checkpointInterval} iterations
**Completion Signal:** <promise>${completionPromise}</promise>
**State File:** .opencode/luffy-loop.json

**Oracle will review at each checkpoint.**

**Next:** Use @luffy_loop command=iterate to advance iterations.`;
  },

  async status() {
    const state = loadState();
    
    if (!state.active) {
      return `**No active loop**

Start a new loop: @luffy_loop command=start prompt="..."`;
    }

    const progress = state.iteration > 0 
      ? `\n**Progress:** ${state.iteration}/${state.maxIterations} iterations`
      : "\n**Progress:** Not started yet";

    const checkpoint = state.paused 
      ? `\n**Status:** ⏸️ PAUSED at checkpoint ${state.lastCheckpoint} - Oracle review pending`
      : `\n**Status:** Running`;

    const nextCheckpoint = state.iteration > 0 && !state.paused
      ? `\n**Next Checkpoint:** At iteration ${Math.min(state.lastCheckpoint + state.checkpointInterval, state.maxIterations)}`
      : "";

    const elapsed = state.startedAt
      ? `\n**Started:** ${new Date(state.startedAt).toLocaleString()}`
      : "";

    let waitingOnOracle = "";
    if (state.paused && state.lastCheckpoint > 0) {
      waitingOnOracle = `\n\n**Waiting for Oracle review.** Oracle will decide: continue/pause/terminate.`;
    }

    return `**🦓 Luffy Loop Status**

**Task:** ${state.prompt.substring(0, 60)}...
${progress}${checkpoint}${nextCheckpoint}${elapsed}${waitingOnOracle}

**State File:** .opencode/luffy-loop.json (persisted)

**Actions:**
- @luffy_loop command=iterate (advance iteration)
- @luffy_loop command=terminate (stop)
- @oracle action=review (Oracle reviews checkpoint)`;
  },

  async iterate() {
    const state = loadState();
    
    if (!state.active) {
      return `**No active loop**

Start a loop: @luffy_loop command=start prompt="..."`;
    }

    if (state.paused) {
      return `**Loop is paused**

Waiting for Oracle review. Oracle will decide: continue/pause/terminate.

Use @oracle action=review to trigger Oracle review, or @luffy_loop command=terminate to stop.`;
    }

    if (state.iteration >= state.maxIterations) {
      return `**Max iterations reached**

Iteration: ${state.iteration}/${state.maxIterations}
Terminate or extend the loop.`;
    }

    state.iteration += 1;
    state.lastIterationAt = new Date().toISOString();
    
    let message = `**Iteration ${state.iteration}/${state.maxIterations}**

Progress: ${state.iteration}/${state.maxIterations} iterations completed`;

    // Check if at checkpoint
    if (state.iteration > 0 && 
        state.iteration % state.checkpointInterval === 0 &&
        state.iteration !== state.lastCheckpoint) {
      
      state.paused = true;
      state.lastCheckpoint = state.iteration;
      saveState(state);
      
      // Return structured signal for programmatic detection
      return JSON.stringify({
        __type: "CHECKPOINT_SIGNAL",
        iteration: state.iteration,
        maxIterations: state.maxIterations,
        prompt: state.prompt,
        stateFile: STATE_FILE,
        paused: true,
        message: `**Checkpoint ${state.iteration} reached!** Loop paused for Oracle review.`,
        action: "INVOKE_ORACLE",
        reason: "Checkpoint interval reached - requires Oracle review and decision"
      }, null, 2);
    } else {
      saveState(state);
      message += `

**Next:** Use @luffy_loop command=iterate to continue, or @luffy_loop command=terminate to stop.`;
    }

    return message;
  },

  async pause() {
    const state = loadState();
    
    if (!state.active) {
      return `**No active loop to pause**

Start a loop first: @luffy_loop command=start prompt="..."`;
    }

    if (state.paused) {
      return `**Loop already paused**

Iteration: ${state.iteration}/${state.maxIterations}
Last checkpoint: ${state.lastCheckpoint}

Use @oracle action=review for Oracle review.`;
    }

    state.paused = true;
    saveState(state);

    return `**⏸️ Luffy Loop Paused**

**Iteration:** ${state.iteration}/${state.maxIterations}
**Last Checkpoint:** ${state.lastCheckpoint}

**Oracle will review and decide next step.**

Use @oracle action=review to trigger Oracle review.`;
  },

  async resume() {
    const state = loadState();
    
    if (!state.active) {
      return `**No active loop to resume**

Start a loop first: @luffy_loop command=start prompt="..."`;
    }

    if (!state.paused) {
      return `**Loop is already running**

Iteration: ${state.iteration}/${state.maxIterations}`;
    }

    // Check if Oracle approved resume
    // For now, allow manual resume (user override)
    state.paused = false;
    saveState(state);

    return `**▶️ Luffy Loop Resumed** (User override)

**Iteration:** ${state.iteration}/${state.maxIterations}
**Next Checkpoint:** ${state.iteration > 0 ? Math.min(state.lastCheckpoint + state.checkpointInterval, state.maxIterations) : state.checkpointInterval}

**Note:** Resume without Oracle approval. Oracle may flag this at next review.`;
  },

  async terminate() {
    const state = loadState();
    
    const wasActive = state.active;
    const iteration = state.iteration;
    const prompt = state.prompt;
    
    resetState();

    if (!wasActive) {
      return `**No active loop to terminate**

Start a loop: @luffy_loop command=start prompt="..."`;
    }

    return `**🛑 Luffy Loop Terminated**

**Iterations completed:** ${iteration}
**Task:** ${prompt.substring(0, 50)}...
**State file:** Removed

**Loop has been stopped.**`;
  }
})
