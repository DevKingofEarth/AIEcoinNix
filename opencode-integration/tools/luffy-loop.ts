import { tool } from "@opencode-ai/plugin"
import fs from "fs";
import path from "path";

const STATE_DIR = path.join(
  process.env.HOME || "~",
  ".config/opencode/.state/sessions"
);

// ============================================================================
// PATH HELPERS
// ============================================================================

function getStateFile(sessionID: string): string {
  return path.join(STATE_DIR, `${sessionID}.json`);
}

// ============================================================================
// MUTEX FOR SAFE WRITES
// ============================================================================

let writeQueue: Promise<void> = Promise.resolve();

async function safeWrite(state: Partial<LoopState>, sessionID: string): Promise<void> {
  await writeQueue;
  
  const stateFile = getStateFile(sessionID);
  
  writeQueue = (async () => {
    const absolutePath = path.resolve(stateFile);
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    let current: LoopState = {
      active: false,
      paused: false,
      iteration: 0,
      maxIterations: 10,
      checkpointInterval: 5,
      completionPromise: "DONE",
      prompt: "",
      startedAt: "",
      lastCheckpoint: 0,
      lastIterationAt: "",
      interventionPlan: null,
      metrics: [],
      oracleDecision: null,
      oracleDecisionAt: null,
      oracleDecisionReason: null,
      nextCheckpointAt: 5,
      progressRate: 0,
      errorRate: 0,
      convergenceScore: 0,
      completedTodos: [],
      failures: []
    };
    
    try {
      if (fs.existsSync(absolutePath)) {
        current = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
      }
    } catch {
      // Use default state
    }
    
    // MERGE strategy - preserve interventionPlan
    const merged: LoopState = {
      ...current,
      ...state,
      // NEVER overwrite interventionPlan - it's set by oracle-control
      interventionPlan: current.interventionPlan,
    };
    
    fs.writeFileSync(absolutePath, JSON.stringify(merged, null, 2));
  })();
  
  await writeQueue;
}

interface IterationMetrics {
  filesChanged: number;
  filesModified: number;
  errorsEncountered: number;
  testsPassed: number;
  testsFailed: number;
  iterationDuration: number;
  timestamp: string;
}

interface InterventionPlan {
  totalIterations: number;
  oracleCheckpoints: number[];
  userCheckpoints: number[];
  totalTodos?: number;
  createdAt: string;
  updatedAt: string;
}

interface Failure {
  id: string;
  iteration: number;
  type: 'user_scold' | 'ai_blunder' | 'disagreement' | 'revert';
  description: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

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
  // Intervention plan from Oracle Phase 1
  interventionPlan: InterventionPlan | null;
  // Dynamic checkpoint fields
  metrics: IterationMetrics[];
  oracleDecision: 'CONTINUE' | 'PAUSE' | 'ADJUST' | 'TERMINATE' | null;
  oracleDecisionAt: string | null;
  oracleDecisionReason: string | null;
  nextCheckpointAt: number;
  progressRate: number;
  errorRate: number;
  convergenceScore: number;
  // Completed TODOs tracking
  completedTodos: string[];
  // Failure tracking
  failures: Failure[];
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
  lastIterationAt: "",
  // Intervention plan defaults
  interventionPlan: null,
  // Dynamic checkpoint defaults
  metrics: [],
  oracleDecision: null,
  oracleDecisionAt: null,
  oracleDecisionReason: null,
  nextCheckpointAt: 5,
  progressRate: 0,
  errorRate: 0,
  convergenceScore: 0,
  completedTodos: [],
  failures: []
};

function loadState(sessionID: string): LoopState {
  try {
    const absolutePath = path.resolve(getStateFile(sessionID));
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

function resetState(sessionID: string): void {
  try {
    const absolutePath = path.resolve(getStateFile(sessionID));
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    // Silently fail
  }
}

// =============================================================================
// DYNAMIC CHECKPOINT CALCULATION
// =============================================================================

function calculateProgressMetrics(state: LoopState): {
  progressRate: number;
  errorRate: number;
  convergenceScore: number;
} {
  const recentMetrics = state.metrics.slice(-state.checkpointInterval);
  
  if (recentMetrics.length === 0) {
    return { progressRate: 0, errorRate: 0, convergenceScore: 0 };
  }
  
  const totalFiles = recentMetrics.reduce((sum, m) => 
    sum + m.filesChanged + m.filesModified, 0);
  const totalErrors = recentMetrics.reduce((sum, m) => 
    sum + m.errorsEncountered, 0);
  
  const progressRate = totalFiles / recentMetrics.length;
  const errorRate = totalErrors / recentMetrics.length;
  const convergenceScore = progressRate / (errorRate + 1);
  
  return { progressRate, errorRate, convergenceScore };
}

function calculateNextCheckpointInterval(state: LoopState): number {
  const { progressRate, errorRate, convergenceScore } = calculateProgressMetrics(state);
  
  // Decision matrix based on convergence
  if (convergenceScore > 2) return 7;       // Excellent - check less often
  if (convergenceScore >= 1) return 5;      // Good - standard interval
  if (convergenceScore >= 0.5) return 3;    // Slow - more oversight
  if (progressRate > 0) return 2;           // Poor - frequent checks
  return 1;                                  // Stuck - immediate checkpoint
}

export default tool({
  description: `🦓 Luffy Loop - Autonomous executor with intervention planning.

**Commands:**
- start: Begin loop with intervention plan
- status: Show progress and metrics
- iterate: Advance one iteration (pauses at intervention points)
- pause: Pause for Oracle review
- resume: Continue after Oracle decision
- terminate: Stop completely
- update_metrics: Record iteration metrics
- complete_todos: Mark TODOs as completed
- check_checkpoint: Check if at intervention point
- get_decision: Read Oracle's decision from state
- record_failure: Record a failure (user scold, AI blunder, disagreement)

**Features:**
- Intervention planning (Oracle + User intervention points)
- Dynamic checkpoint intervals
- Metrics tracking: files changed, errors, tests
- Failure tracking: user scolds, AI blunders, disagreements
- State-driven protocol (survives restarts)

**Workflow:**
1. @oracle Phase 1: Create intervention plan
2. @luffy_loop start with plan
3. Builder: Do work → update_metrics → iterate
4. At intervention: Auto-pause, invoke @oracle
5. Oracle: Reviews → set_decision
6. Builder: resume
7. On failure: @luffy_loop record_failure
8. On completion: @oracle verify`,

  args: {
    command: tool.schema.enum([
      "start", "status", "iterate", "pause", "resume", "terminate",
      "update_metrics", "check_checkpoint", "get_decision", "complete_todos",
      "record_failure"
    ]).describe("Command to execute"),
    prompt: tool.schema.string().optional().describe("Task prompt (for start)"),
    maxIterations: tool.schema.number().min(1).max(100).default(10).optional()
      .describe("Max iterations (default: 10)"),
    checkpointInterval: tool.schema.number().min(1).max(50).default(5).optional()
      .describe("Initial checkpoint interval (default: 5)"),
    completionPromise: tool.schema.string().default("DONE").optional()
      .describe("Completion signal"),
    // update_metrics args
    filesChanged: tool.schema.number().default(0).optional().describe("Files created"),
    filesModified: tool.schema.number().default(0).optional().describe("Files modified"),
    errorsEncountered: tool.schema.number().default(0).optional().describe("Errors"),
    testsPassed: tool.schema.number().default(0).optional().describe("Tests passed"),
    testsFailed: tool.schema.number().default(0).optional().describe("Tests failed"),
    iterationDuration: tool.schema.number().default(0).optional().describe("Duration in ms"),
    // set_decision args
    decision: tool.schema.enum(["CONTINUE", "PAUSE", "ADJUST", "TERMINATE"]).optional()
      .describe("Oracle's decision"),
    reason: tool.schema.string().optional().describe("Reason for decision"),
    // record_failure args
    failureType: tool.schema.enum(["user_scold", "ai_blunder", "disagreement", "revert"]).optional()
      .describe("Type of failure"),
    failureDescription: tool.schema.string().optional().describe("Description of failure"),
    // complete_todos args
    completedTodos: tool.schema.array(tool.schema.string()).optional()
      .describe("TODOs completed this iteration")
  },

  async execute(args, context) {
    const sessionID = context.sessionID;
    const { command } = args;

    switch (command) {
      case "start":
        return await this.startLoop(
          sessionID,
          args.prompt || "",
          args.maxIterations || 10,
          args.checkpointInterval || 5,
          args.completionPromise || "DONE"
        );
      case "status":
        return await this.status(sessionID);
      case "iterate":
        return await this.iterate(sessionID);
      case "pause":
        return await this.pause(sessionID);
      case "resume":
        return await this.resume(sessionID);
      case "terminate":
        return await this.terminate(sessionID);
      case "update_metrics":
        return await this.updateMetrics(sessionID, {
          filesChanged: args.filesChanged || 0,
          filesModified: args.filesModified || 0,
          errorsEncountered: args.errorsEncountered || 0,
          testsPassed: args.testsPassed || 0,
          testsFailed: args.testsFailed || 0,
          iterationDuration: args.iterationDuration || 0
        });
      case "check_checkpoint":
        return await this.checkCheckpoint(sessionID);
      case "get_decision":
        return await this.getDecision(sessionID);
      case "complete_todos":
        return await this.completeTodos(sessionID, args.completedTodos || []);
      case "record_failure":
        return await this.recordFailure(
          sessionID,
          args.failureType as any || "ai_blunder",
          args.failureDescription || ""
        );
      default:
        return `Unknown command: ${command}`;
    }
  },

  async startLoop(sessionID: string, prompt: string, maxIterations: number, checkpointInterval: number, completionPromise: string) {
    let state = loadState(sessionID);
    
    if (state.active) {
      return `**Loop already active**

Task: ${state.prompt}
Iteration: ${state.iteration}/${state.maxIterations}
Status: ${state.paused ? "Paused" : "Running"}

Use @luffy_loop command=status to check progress, or terminate first.`;
    }

    // Check if intervention plan exists
    const hasInterventionPlan = state.interventionPlan !== null;
    const iterationsToUse = hasInterventionPlan ? state.interventionPlan!.totalIterations : maxIterations;
    const firstCheckpoint = hasInterventionPlan 
      ? (state.interventionPlan!.oracleCheckpoints[0] || iterationsToUse)
      : checkpointInterval;

    const newState: LoopState = {
      ...DEFAULT_STATE,
      active: true,
      paused: false,
      iteration: 0,
      maxIterations: iterationsToUse,
      checkpointInterval: hasInterventionPlan ? firstCheckpoint : checkpointInterval,
      completionPromise,
      prompt,
      startedAt: new Date().toISOString(),
      nextCheckpointAt: firstCheckpoint,
      interventionPlan: hasInterventionPlan ? state.interventionPlan : null,
      completedTodos: [],
      failures: []
    };
    
    safeWrite(newState, sessionID);

    const planInfo = hasInterventionPlan
      ? `
**Intervention Plan:**
- Total Iterations: ${state.interventionPlan!.totalIterations}
${state.interventionPlan!.totalTodos ? `- Total TODOs: ${state.interventionPlan!.totalTodos}` : ''}
- Oracle Checkpoints: [${state.interventionPlan!.oracleCheckpoints.join(", ")}]
- User Checkpoints: [${state.interventionPlan!.userCheckpoints.join(", ")}]`
      : "";

    return `**🦓 Luffy Loop Started**

**Task:** ${prompt}
**Max Iterations:** ${iterationsToUse}
**First Intervention:** At iteration ${firstCheckpoint}
**Completion Signal:** <promise>${completionPromise}</promise>
**State File:** ~/.config/opencode/.state/luffy-loop.json${planInfo}

**Protocol:**
1. Builder: Do work → update_metrics → iterate
2. At intervention: Auto-pause, invoke @oracle
3. Oracle: Reviews → set_decision
4. Builder: resume
5. On completion: @oracle verify

**Next:** Builder executes first iteration.`;
  },

  async status(sessionID: string) {
    const state = loadState(sessionID);
    
    if (!state.active) {
      return `**No active loop**

Start a new loop: @luffy_loop command=start prompt="..."`;
    }

    const { progressRate, errorRate, convergenceScore } = calculateProgressMetrics(state);

    const progress = state.iteration > 0 
      ? `\n**Progress:** ${state.iteration}/${state.maxIterations} (${Math.round((state.iteration/state.maxIterations)*100)}%)`
      : "\n**Progress:** Not started yet";

    const checkpoint = state.paused 
      ? `\n**Status:** ⏸️ PAUSED at iteration ${state.iteration} - Oracle review pending`
      : `\n**Status:** ▶️ Running`;

    const nextCheckpoint = !state.paused
      ? `\n**Next Checkpoint:** At iteration ${state.nextCheckpointAt}`
      : "";

    const elapsed = state.startedAt
      ? `\n**Started:** ${new Date(state.startedAt).toLocaleString()}`
      : "";

    const oracleStatus = state.oracleDecision
      ? `\n**Oracle Decision:** ${state.oracleDecision}`
      : state.paused 
        ? "\n**Oracle:** Waiting for review"
        : "";

    const metricsSummary = state.metrics.length > 0
      ? `\n\n**Metrics (last ${Math.min(state.metrics.length, state.checkpointInterval)} iters):**
- Files: ${state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.filesChanged + m.filesModified, 0)}
- Errors: ${state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.errorsEncountered, 0)}
- Convergence: ${convergenceScore.toFixed(2)}`
      : "";

    return `**🦓 Luffy Loop Status**

**Task:** ${state.prompt.substring(0, 80)}...
${progress}${checkpoint}${nextCheckpoint}${elapsed}${oracleStatus}${metricsSummary}

**State File:** ~/.config/opencode/.state/luffy-loop.json`;
  },

  async iterate(sessionID: string) {
    const state = loadState(sessionID);
    
    if (!state.active) {
      return `**No active loop**

Start a loop: @luffy_loop command=start prompt="..."`;
    }

    // ENFORCEMENT: Cannot iterate if paused without decision
    if (state.paused && !state.oracleDecision) {
      return JSON.stringify({
        error: true,
        blocked: true,
        reason: "PAUSED_WITHOUT_DECISION",
        message: "Cannot iterate: Loop is paused but no Oracle decision exists.",
        requiredAction: "@oracle review checkpoint before resuming",
        currentState: {
          iteration: state.iteration,
          paused: state.paused,
          oracleDecision: state.oracleDecision
        }
      }, null, 2);
    }

    if (state.paused) {
      const decisionInfo = state.oracleDecision
        ? `\n**Oracle decided:** ${state.oracleDecision}`
        : "\n**Waiting for Oracle decision.**";
      
      return `**Loop is paused**

Iteration: ${state.iteration}/${state.maxIterations}${decisionInfo}

Actions:
- If Oracle decided CONTINUE: @luffy_loop command=resume
- If no decision: @oracle needs to review`;
    }

    if (state.iteration >= state.maxIterations) {
      // Check if we have an intervention plan for completion
      if (state.interventionPlan) {
        // Check if this is a user intervention point (completion)
        const isUserCheckpoint = state.interventionPlan.userCheckpoints.includes(state.iteration);
        if (isUserCheckpoint) {
          state.paused = true;
          safeWrite(state, sessionID);
          
          return JSON.stringify({
            __type: "CHECKPOINT_SIGNAL",
            iteration: state.iteration,
            maxIterations: state.maxIterations,
            interventionType: "user",
            prompt: state.prompt,
            paused: true,
            metrics: {
              progressRate: state.progressRate,
              errorRate: state.errorRate,
              convergenceScore: state.convergenceScore,
              filesChanged: state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.filesChanged, 0),
              filesModified: state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.filesModified, 0),
              errorsEncountered: state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.errorsEncountered, 0)
            },
            action: "INVOKE_ORACLE",
            message: `**Completion milestone reached!** Iteration ${state.iteration}/${state.maxIterations}. Loop paused for user notification.`
          }, null, 2);
        }
      }
      
      // All iterations complete
      return `**✅ All iterations complete!**

Iteration: ${state.iteration}/${state.maxIterations}

<promise>DONE</promise>

**Next:** Delegate to @oracle for verification.`;
    }

    // Advance iteration
    state.iteration += 1;
    state.lastIterationAt = new Date().toISOString();
    
    // Check if at intervention point (Oracle or User)
    let interventionType: "oracle" | "user" | null = null;
    
    if (state.interventionPlan) {
      if (state.interventionPlan.oracleCheckpoints.includes(state.iteration)) {
        interventionType = "oracle";
      }
      else if (state.interventionPlan.userCheckpoints.includes(state.iteration)) {
        interventionType = "user";
      }
    }
    
    // Also check dynamic checkpoint (fallback)
    if (!interventionType && state.iteration >= state.nextCheckpointAt) {
      interventionType = "oracle";
    }
    
    if (interventionType) {
      state.paused = true;
      state.lastCheckpoint = state.iteration;
      
      // Calculate metrics for Oracle
      const { progressRate, errorRate, convergenceScore } = calculateProgressMetrics(state);
      state.progressRate = progressRate;
      state.errorRate = errorRate;
      state.convergenceScore = convergenceScore;
      
      safeWrite(state, sessionID);
      
      // Return structured signal with intervention type
      return JSON.stringify({
        __type: "CHECKPOINT_SIGNAL",
        iteration: state.iteration,
        maxIterations: state.maxIterations,
        nextCheckpointAt: state.nextCheckpointAt,
        interventionType: interventionType,
        prompt: state.prompt,
        paused: true,
        metrics: {
          progressRate: state.progressRate,
          errorRate: state.errorRate,
          convergenceScore: state.convergenceScore,
          filesChanged: state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.filesChanged, 0),
          filesModified: state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.filesModified, 0),
          errorsEncountered: state.metrics.slice(-state.checkpointInterval).reduce((s,m) => s + m.errorsEncountered, 0)
        },
        action: interventionType === "user" ? "NOTIFY_USER" : "INVOKE_ORACLE",
        message: interventionType === "user" 
          ? `**User Intervention Point ${state.iteration}!** Loop paused for user notification.`
          : `**Checkpoint ${state.iteration} reached!** Loop paused for Oracle review.`
      }, null, 2);
    }
    
    safeWrite(state, sessionID);
    
    return `**Iteration ${state.iteration}/${state.maxIterations}**

Progress: ${Math.round((state.iteration/state.maxIterations)*100)}%
Next checkpoint: At iteration ${state.interventionPlan ? 
  (state.interventionPlan.oracleCheckpoints.find(i => i > state.iteration) || 
   state.interventionPlan.userCheckpoints.find(i => i > state.iteration) || 
   state.maxIterations) : 
  state.nextCheckpointAt}

**Next:** 
- Do work
- @luffy_loop command=update_metrics ...
- @luffy_loop command=iterate`;
  },

  async pause(sessionID: string) {
    const state = loadState(sessionID);
    
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
    safeWrite(state, sessionID);

    return `**⏸️ Luffy Loop Paused**

**Iteration:** ${state.iteration}/${state.maxIterations}
**Last Checkpoint:** ${state.lastCheckpoint}

**Oracle will review and decide next step.**

Use @oracle action=review to trigger Oracle review.`;
  },

  async resume(sessionID: string) {
    const state = loadState(sessionID);
    
    if (!state.active) {
      return `**No active loop to resume**

Start a loop first: @luffy_loop command=start prompt="..."`;
    }

    if (!state.paused) {
      return `**Loop is already running**

Iteration: ${state.iteration}/${state.maxIterations}`;
    }

    // Calculate next checkpoint interval
    let nextInterval: number;
    
    if (state.interventionPlan) {
      const nextOracle = state.interventionPlan.oracleCheckpoints.find(i => i > state.iteration);
      if (nextOracle) {
        nextInterval = nextOracle - state.iteration;
        state.nextCheckpointAt = nextOracle;
      } else {
        nextInterval = 1;
        state.nextCheckpointAt = state.iteration + 1;
      }
    } else {
      // Fallback to dynamic calculation
      nextInterval = calculateNextCheckpointInterval(state);
      state.nextCheckpointAt = state.iteration + nextInterval;
    }
    
    state.checkpointInterval = nextInterval;
    state.paused = false;
    
    // Clear Oracle decision after acting on it
    const previousDecision = state.oracleDecision;
    const previousReason = state.oracleDecisionReason;
    state.oracleDecision = null;
    state.oracleDecisionAt = null;
    state.oracleDecisionReason = null;
    
    safeWrite(state, sessionID);

    return `**▶️ Luffy Loop Resumed**

**Iteration:** ${state.iteration}/${state.maxIterations}
**Next Checkpoint:** At iteration ${state.nextCheckpointAt} (interval: ${nextInterval})
**Previous Decision:** ${previousDecision || 'manual resume'}
${previousReason ? `**Reason:** ${previousReason}` : ''}

**Protocol:** Do work → update_metrics → iterate`;
  },

  async terminate(sessionID: string) {
    const state = loadState(sessionID);
    
    const wasActive = state.active;
    const iteration = state.iteration;
    const prompt = state.prompt;
    
    resetState(sessionID);

    if (!wasActive) {
      return `**No active loop to terminate**

Start a loop: @luffy_loop command=start prompt="..."`;
    }

    return `**🛑 Luffy Loop Terminated**

**Iterations completed:** ${iteration}
**Task:** ${prompt.substring(0, 60)}...
**State file:** Removed

**Loop has been stopped.**`;
  },

  // ===========================================================================
  // NEW: Metrics & Protocol Commands
  // ===========================================================================

  async updateMetrics(sessionID: string, metrics: {
    filesChanged: number;
    filesModified: number;
    errorsEncountered: number;
    testsPassed: number;
    testsFailed: number;
    iterationDuration: number;
  }) {
    const state = loadState(sessionID);
    
    if (!state.active) {
      return `**No active loop**

Start a loop first: @luffy_loop command=start prompt="..."`;
    }

    const newMetrics: IterationMetrics = {
      ...metrics,
      timestamp: new Date().toISOString()
    };
    
    state.metrics.push(newMetrics);
    
    // Keep only last 50 iterations to prevent file bloat
    if (state.metrics.length > 50) {
      state.metrics = state.metrics.slice(-50);
    }
    
    // Update calculated metrics
    const { progressRate, errorRate, convergenceScore } = calculateProgressMetrics(state);
    state.progressRate = progressRate;
    state.errorRate = errorRate;
    state.convergenceScore = convergenceScore;
    
    safeWrite(state, sessionID);

    return `**Metrics Updated**

Iteration ${state.iteration}:
- Files: ${metrics.filesChanged} changed, ${metrics.filesModified} modified
- Errors: ${metrics.errorsEncountered}
- Tests: ${metrics.testsPassed} passed, ${metrics.testsFailed} failed
- Duration: ${metrics.iterationDuration}ms

**Running:**
- Progress rate: ${progressRate.toFixed(2)} files/iteration
- Convergence: ${convergenceScore.toFixed(2)}

**Next:** @luffy_loop command=iterate`;
  },

  async checkCheckpoint(sessionID: string) {
    const state = loadState(sessionID);
    
    if (!state.active) {
      return JSON.stringify({
        reached: false,
        active: false,
        message: "No active loop"
      }, null, 2);
    }

    const reached = state.iteration >= state.nextCheckpointAt;
    
    return JSON.stringify({
      reached,
      active: true,
      paused: state.paused,
      currentIteration: state.iteration,
      nextCheckpointAt: state.nextCheckpointAt,
      iterationsUntilCheckpoint: state.nextCheckpointAt - state.iteration
    }, null, 2);
  },

  async getDecision(sessionID: string) {
    const state = loadState(sessionID);
    
    if (!state.active) {
      return JSON.stringify({
        decision: null,
        message: "No active loop"
      }, null, 2);
    }

    return JSON.stringify({
      decision: state.oracleDecision,
      nextCheckpointAt: state.nextCheckpointAt,
      reason: state.oracleDecisionReason,
      decidedAt: state.oracleDecisionAt,
      currentIteration: state.iteration,
      metrics: {
        progressRate: state.progressRate,
        errorRate: state.errorRate,
        convergenceScore: state.convergenceScore
      }
    }, null, 2);
  },

  async recordFailure(sessionID: string, type: 'user_scold' | 'ai_blunder' | 'disagreement' | 'revert', description: string) {
    const state = loadState(sessionID);
    
    if (!state.failures) {
      state.failures = [];
    }
    
    const failure: Failure = {
      id: `fail-${Date.now()}`,
      iteration: state.iteration,
      type,
      description,
      resolved: false,
      resolvedAt: null,
      createdAt: new Date().toISOString()
    };
    
    state.failures.push(failure);
    safeWrite(state, sessionID);
    
    return `**Failure Recorded** ⚠️

**ID:** ${failure.id}
**Type:** ${type}
**Iteration:** ${state.iteration}
**Description:** ${description}

**Total Failures:** ${state.failures.length}
**Unresolved:** ${state.failures.filter(f => !f.resolved).length}`;
  },

  async completeTodos(sessionID: string, completed: string[]) {
    const state = loadState(sessionID);
    
    if (!state.active) {
      return `**No active loop**`;
    }
    
    if (!state.completedTodos) {
      state.completedTodos = [];
    }
    
    state.completedTodos = [...new Set([...state.completedTodos, ...completed])];
    safeWrite(state, sessionID);
    
    return `**TODOs Completed**

Completed this update: [${completed.join(", ")}]
Total completed: ${state.completedTodos.length}
${state.interventionPlan?.totalTodos ? `Progress: ${state.completedTodos.length}/${state.interventionPlan.totalTodos}` : ''}`;
  }
})
