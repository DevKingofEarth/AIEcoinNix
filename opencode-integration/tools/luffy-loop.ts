import { tool } from "@opencode-ai/plugin"
import fs from "fs";
import path from "path";

const STATE_FILE = path.join(
  process.env.HOME || "~",
  ".config/opencode/.state/luffy-loop.json"
);

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
  totalTodos: number;
  todosPerIteration: number;
  iterationsNeeded: number;
  oracleInterventions: number[];
  userInterventions: number[];
  createdAt: string;
  updatedAt: string;
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
  completedTodos: []
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
- check_checkpoint: Check if at intervention point
- get_decision: Read Oracle's decision from state
- set_decision: Write Oracle's decision

**Features:**
- Intervention planning (Oracle + User intervention points)
- Dynamic checkpoint intervals
- Metrics tracking: files changed, errors, tests
- State-driven protocol (survives restarts)

**Workflow:**
1. @oracle Phase 1: Create intervention plan
2. @luffy_loop start with plan
3. Builder: Do work → update_metrics → iterate
4. At intervention: Auto-pause, invoke @oracle
5. Oracle: Reviews → set_decision
6. Builder: resume
7. On completion: @oracle verify`,

  args: {
    command: tool.schema.enum([
      "start", "status", "iterate", "pause", "resume", "terminate",
      "update_metrics", "check_checkpoint", "get_decision", "set_decision"
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
    reason: tool.schema.string().optional().describe("Reason for decision")
  },

  async execute(args, context) {
    const { command } = args;

    switch (command) {
      case "start":
        return await this.startLoop(
          args.prompt || "",
          args.maxIterations || 10,
          args.checkpointInterval || 5,
          args.completionPromise || "DONE"
        );
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
      case "update_metrics":
        return await this.updateMetrics({
          filesChanged: args.filesChanged || 0,
          filesModified: args.filesModified || 0,
          errorsEncountered: args.errorsEncountered || 0,
          testsPassed: args.testsPassed || 0,
          testsFailed: args.testsFailed || 0,
          iterationDuration: args.iterationDuration || 0
        });
      case "check_checkpoint":
        return await this.checkCheckpoint();
      case "get_decision":
        return await this.getDecision();
      case "set_decision":
        return await this.setDecision(args.decision || "CONTINUE", args.reason || "");
      default:
        return `Unknown command: ${command}`;
    }
  },

  async startLoop(prompt: string, maxIterations: number, checkpointInterval: number, completionPromise: string) {
    let state = loadState();
    
    if (state.active) {
      return `**Loop already active**

Task: ${state.prompt}
Iteration: ${state.iteration}/${state.maxIterations}
Status: ${state.paused ? "Paused" : "Running"}

Use @luffy_loop command=status to check progress, or terminate first.`;
    }

    // Check if intervention plan exists
    const hasInterventionPlan = state.interventionPlan !== null;
    const iterationsToUse = hasInterventionPlan ? state.interventionPlan!.iterationsNeeded : maxIterations;
    const firstCheckpoint = hasInterventionPlan 
      ? (state.interventionPlan!.oracleInterventions[0] || iterationsToUse)
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
      completedTodos: []
    };
    
    saveState(newState);

    const planInfo = hasInterventionPlan
      ? `
**Intervention Plan:**
- Total TODOs: ${state.interventionPlan!.totalTodos}
- Iterations: ${state.interventionPlan!.iterationsNeeded}
- Oracle interventions: [${state.interventionPlan!.oracleInterventions.join(", ")}]
- User interventions: [${state.interventionPlan!.userInterventions.join(", ")}]`
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

  async status() {
    const state = loadState();
    
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

  async iterate() {
    const state = loadState();
    
    if (!state.active) {
      return `**No active loop**

Start a loop: @luffy_loop command=start prompt="..."`;
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
        const isUserIntervention = state.interventionPlan.userInterventions.includes(state.iteration);
        if (isUserIntervention) {
          state.paused = true;
          saveState(state);
          
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
      // Check Oracle intervention points
      if (state.interventionPlan.oracleInterventions.includes(state.iteration)) {
        interventionType = "oracle";
      }
      // Check User intervention points
      else if (state.interventionPlan.userInterventions.includes(state.iteration)) {
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
      
      saveState(state);
      
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
    
    saveState(state);
    
    return `**Iteration ${state.iteration}/${state.maxIterations}**

Progress: ${Math.round((state.iteration/state.maxIterations)*100)}%
Next intervention: At iteration ${state.interventionPlan ? 
  (state.interventionPlan.oracleInterventions.find(i => i > state.iteration) || 
   state.interventionPlan.userInterventions.find(i => i > state.iteration) || 
   state.maxIterations) : 
  state.nextCheckpointAt}

**Next:** 
- Do work
- @luffy_loop command=update_metrics ...
- @luffy_loop command=iterate`;
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

    // Calculate next checkpoint interval
    let nextInterval: number;
    
    if (state.interventionPlan) {
      // Use pre-planned intervention points
      const nextOracle = state.interventionPlan.oracleInterventions.find(i => i > state.iteration);
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
    
    saveState(state);

    return `**▶️ Luffy Loop Resumed**

**Iteration:** ${state.iteration}/${state.maxIterations}
**Next Checkpoint:** At iteration ${state.nextCheckpointAt} (interval: ${nextInterval})
**Previous Decision:** ${previousDecision || 'manual resume'}
${previousReason ? `**Reason:** ${previousReason}` : ''}

**Protocol:** Do work → update_metrics → iterate`;
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
**Task:** ${prompt.substring(0, 60)}...
**State file:** Removed

**Loop has been stopped.**`;
  },

  // ===========================================================================
  // NEW: Metrics & Protocol Commands
  // ===========================================================================

  async updateMetrics(metrics: {
    filesChanged: number;
    filesModified: number;
    errorsEncountered: number;
    testsPassed: number;
    testsFailed: number;
    iterationDuration: number;
  }) {
    const state = loadState();
    
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
    
    saveState(state);

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

  async checkCheckpoint() {
    const state = loadState();
    
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

  async getDecision() {
    const state = loadState();
    
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

  async setDecision(decision: 'CONTINUE' | 'PAUSE' | 'TERMINATE', reason: string) {
    const state = loadState();
    
    if (!state.active) {
      return `**Cannot set decision: No active loop**`;
    }

    state.oracleDecision = decision;
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = reason;
    
    // If CONTINUE, calculate next checkpoint interval
    if (decision === 'CONTINUE') {
      const nextInterval = calculateNextCheckpointInterval(state);
      state.nextCheckpointAt = state.iteration + nextInterval;
      state.checkpointInterval = nextInterval;
    }
    
    saveState(state);

    const intervalInfo = decision === 'CONTINUE' 
      ? `\n**Next checkpoint:** Iteration ${state.nextCheckpointAt} (interval: ${state.checkpointInterval})`
      : '';

    return `**Oracle Decision Recorded**

**Decision:** ${decision}
**Reason:** ${reason || 'Not specified'}
**At:** ${state.oracleDecisionAt}${intervalInfo}

**Builder action:**
${decision === 'CONTINUE' ? '- @luffy_loop command=resume' : ''}
${decision === 'PAUSE' ? '- Wait for user input' : ''}
${decision === 'TERMINATE' ? '- @luffy_loop command=terminate' : ''}`;
  }
})
