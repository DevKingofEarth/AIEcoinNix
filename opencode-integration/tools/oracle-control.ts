import { tool } from "@opencode-ai/plugin"
import fs from "fs";
import path from "path";

const STATE_FILE = path.join(
  process.env.HOME || "~",
  ".config/opencode/.state/luffy-loop.json"
);

// ============================================================================
// INTERFACES
// ============================================================================

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

interface AttemptRecord {
  id: string;
  type: 'direct' | 'loop';
  task: string;
  status: 'success' | 'failed' | 'terminated';
  completedAt: string;
  iterations?: number;
  error?: string;
}

interface ErrorRecord {
  iteration: number;
  type: string;
  description: string;
  timestamp: string;
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
  // Intervention plan (Phase 1)
  interventionPlan: InterventionPlan | null;
  // Simple vs Complex decision
  taskDecision: 'SIMPLE' | 'COMPLEX' | null;
  // Dynamic checkpoint fields
  metrics: IterationMetrics[];
  oracleDecision: 'CONTINUE' | 'PAUSE' | 'ADJUST' | 'TERMINATE' | null;
  oracleDecisionAt: string | null;
  oracleDecisionReason: string | null;
  nextCheckpointAt: number;
  progressRate: number;
  errorRate: number;
  convergenceScore: number;
  // Phase 4 verification
  completedTodos: string[];
  verificationStatus: 'pending' | 'approved' | 'revision_requested' | null;
  // Error and attempt tracking
  errors: ErrorRecord[];
  previousAttempts: AttemptRecord[];
  terminatedWithReason: string | null;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

function loadState(): LoopState | null {
  try {
    const absolutePath = path.resolve(STATE_FILE);
    if (fs.existsSync(absolutePath)) {
      const content = fs.readFileSync(absolutePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    // Ignore
  }
  return null;
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
    // Ignore
  }
}

// ============================================================================
// CALCULATION FUNCTIONS
// ============================================================================

function calculateNextInterval(state: LoopState): number {
  const { progressRate, errorRate, convergenceScore } = state;
  
  if (convergenceScore > 2) return 7;
  if (convergenceScore >= 1) return 5;
  if (convergenceScore >= 0.5) return 3;
  if (progressRate > 0) return 2;
  return 1;
}

function calculateIterations(totalTodos: number, todosPerIteration: number = 3): number {
  return Math.ceil(totalTodos / todosPerIteration);
}

function planInterventions(iterationsNeeded: number): {
  oracleInterventions: number[];
  userInterventions: number[];
} {
  const oracleInterventions: number[] = [];
  const userInterventions: number[] = [];
  
  // Oracle interventions at 25%, 50%, 75%
  const oraclePoints = [0.25, 0.5, 0.75];
  oraclePoints.forEach(pct => {
    const iter = Math.ceil(iterationsNeeded * pct);
    if (iter > 0 && iter < iterationsNeeded) {
      oracleInterventions.push(iter);
    }
  });
  
  // User interventions at milestones (33%, 66%, 100%)
  const userPoints = [0.33, 0.66, 1.0];
  userPoints.forEach(pct => {
    const iter = Math.ceil(iterationsNeeded * pct);
    if (iter > 0 && !userInterventions.includes(iter)) {
      userInterventions.push(iter);
    }
  });
  
  return { oracleInterventions, userInterventions };
}

function makeDecision(state: LoopState): {
  decision: 'CONTINUE' | 'PAUSE' | 'ADJUST' | 'TERMINATE';
  reason: string;
  nextInterval?: number;
} {
  const { progressRate, errorRate, convergenceScore, iteration, maxIterations } = state;
  const progressPercent = Math.round((iteration / maxIterations) * 100);
  
  // No progress - pause for user
  if (progressRate === 0 && iteration > 3) {
    return {
      decision: 'PAUSE',
      reason: `No progress for ${iteration} iterations. Need user guidance.`
    };
  }
  
  // High error rate - pause
  if (errorRate > 2 && convergenceScore < 0.5) {
    return {
      decision: 'PAUSE',
      reason: `High error rate (${errorRate.toFixed(1)}/iter) with low convergence.`
    };
  }
  
  // Near completion
  if (progressPercent >= 80) {
    return {
      decision: 'CONTINUE',
      reason: `Near completion (${progressPercent}%).`,
      nextInterval: Math.min(calculateNextInterval(state), 3)
    };
  }
  
  // Good progress
  if (convergenceScore >= 0.5) {
    const nextInterval = calculateNextInterval(state);
    return {
      decision: 'CONTINUE',
      reason: `Convergence: ${convergenceScore.toFixed(2)}. Progress: ${progressRate.toFixed(1)} files/iter.`,
      nextInterval
    };
  }
  
  // Struggling
  if (progressRate > 0) {
    return {
      decision: 'CONTINUE',
      reason: `Slow progress (${progressRate.toFixed(1)} files/iter). More checks.`,
      nextInterval: 2
    };
  }
  
  // Default - pause
  return {
    decision: 'PAUSE',
    reason: 'Unable to determine progress. Manual review needed.'
  };
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export default tool({
  description: `Oracle - Strategic controller for Luffy Loop. Manages intervention planning, checkpoint reviews, and verification.

**Actions:**
- set_intervention_plan: Oracle Phase 1 - plan interventions before loop starts
- get_intervention_plan: Read current intervention plan
- calculate_iterations: Calculate iterations from TODO count
- set_decision: Write decision at checkpoint
- get_decision: Read decision from state
- status: Get current loop status
- review: Review checkpoint and make decision
- verify: Phase 4 - verify completion against plan
- purge_state: Clear old state before new task
- record_attempt: Record direct (loop-less) attempt
- record_error: Record error during execution
- get_previous_attempts: Get previous failure history
- terminate_and_clear: Terminate and clear remaining checkpoints`,

  args: {
    action: tool.schema.enum([
      "set_intervention_plan", "get_intervention_plan", "calculate_iterations",
      "set_decision", "get_decision", "status", "review", "verify",
      "purge_state", "record_attempt", "record_error", "get_previous_attempts", "terminate_and_clear"
    ]).describe("Action to perform"),
    // set_intervention_plan args
    totalTodos: tool.schema.number().optional().describe("Total number of TODOs"),
    todosPerIteration: tool.schema.number().optional().describe("TODOs per iteration (default: 3)"),
    // set_decision args
    decision: tool.schema.enum(["CONTINUE", "PAUSE", "ADJUST", "TERMINATE"]).optional()
      .describe("Decision: CONTINUE, PAUSE, ADJUST, or TERMINATE"),
    reason: tool.schema.string().optional().describe("Reason for decision"),
    // review args
    task_context: tool.schema.string().optional().describe("Context for review"),
    // calculate args
    todoCount: tool.schema.number().optional().describe("Number of TODOs"),
    // record_attempt args
    attemptType: tool.schema.enum(["direct", "loop"]).optional().describe("Type of attempt"),
    taskDescription: tool.schema.string().optional().describe("Task description"),
    // record_error args
    iteration: tool.schema.number().optional().describe("Iteration where error occurred"),
    errorType: tool.schema.string().optional().describe("Type of error"),
    errorDescription: tool.schema.string().optional().describe("Error description"),
    // terminate_and_clear args
    remainingCheckpoints: tool.schema.number().optional().describe("Remaining checkpoints")
  },

  async execute(args) {
    const { action, totalTodos, todosPerIteration, decision, reason, task_context, todoCount, attemptType, taskDescription, iteration, errorType, errorDescription, remainingCheckpoints } = args;
    
    switch (action) {
      case "set_intervention_plan":
        return this.setInterventionPlan(totalTodos!, todosPerIteration || 3);
      case "get_intervention_plan":
        return this.getInterventionPlan();
      case "calculate_iterations":
        return this.calculateIterations(todoCount!, todosPerIteration || 3);
      case "set_decision":
        return this.setDecision(decision!, reason || "");
      case "get_decision":
        return this.getDecision();
      case "status":
        return this.status();
      case "review":
        return this.review(task_context);
      case "verify":
        return this.verify();
      case "purge_state":
        return this.purgeState();
      case "record_attempt":
        return this.recordAttempt(attemptType || "direct", taskDescription || "");
      case "record_error":
        return this.recordError(iteration || 0, errorType || "unknown", errorDescription || "");
      case "get_previous_attempts":
        return this.getPreviousAttempts();
      case "terminate_and_clear":
        return this.terminateAndClear(remainingCheckpoints || 0, reason || "User requested");
      default:
        return "Unknown action: " + action;
    }
  },

  // =========================================================================
  // PHASE 1: INTERVENTION PLANNING
  // =========================================================================

  setInterventionPlan(totalTodos: number, todosPerIteration: number) {
    let state = loadState();
    
    // Create new state if none exists
    if (!state) {
      state = {
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
        verificationStatus: null
      };
    }
    
    // Calculate iterations needed
    const iterationsNeeded = calculateIterations(totalTodos, todosPerIteration);
    
    // Plan intervention points
    const { oracleInterventions, userInterventions } = planInterventions(iterationsNeeded);
    
    // Create intervention plan
    const plan: InterventionPlan = {
      totalTodos,
      todosPerIteration,
      iterationsNeeded,
      oracleInterventions,
      userInterventions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    state.interventionPlan = plan;
    state.maxIterations = iterationsNeeded;
    state.nextCheckpointAt = oracleInterventions[0] || iterationsNeeded;
    state.checkpointInterval = oracleInterventions[0] || 1;
    
    saveState(state);
    
    return `**Intervention Plan Created**

**Total TODOs:** ${totalTodos}
**TODOs per Iteration:** ${todosPerIteration}
**Iterations Needed:** ${iterationsNeeded}

**Oracle Interventions:** [${oracleInterventions.join(", ")}]
**User Interventions:** [${userInterventions.join(", ")}]

**Plan written to state.**
**Next:** Builder executes first task, then starts Luffy Loop.`;
  },

  getInterventionPlan() {
    const state = loadState();
    
    if (!state || !state.interventionPlan) {
      return JSON.stringify({
        exists: false,
        message: "No intervention plan found. Run set_intervention_plan first."
      }, null, 2);
    }
    
    return JSON.stringify({
      exists: true,
      plan: state.interventionPlan,
      currentIteration: state.iteration,
      nextOracleIntervention: state.interventionPlan.oracleInterventions.find(i => i > state.iteration),
      nextUserIntervention: state.interventionPlan.userInterventions.find(i => i > state.iteration)
    }, null, 2);
  },

  calculateIterations(todoCount: number, todosPerIteration: number = 3) {
    const iterationsNeeded = calculateIterations(todoCount, todosPerIteration);
    const { oracleInterventions, userInterventions } = planInterventions(iterationsNeeded);
    
    return JSON.stringify({
      todoCount,
      todosPerIteration,
      iterationsNeeded,
      oracleInterventions,
      userInterventions,
      estimatedDuration: `${iterationsNeeded * 5} minutes (approx)`
    }, null, 2);
  },

  // =========================================================================
  // CHECKPOINT DECISIONS
  // =========================================================================

  setDecision(decision: 'CONTINUE' | 'PAUSE' | 'ADJUST' | 'TERMINATE', reason: string) {
    const state = loadState();
    
    if (!state || !state.active) {
      return "**Cannot set decision: No active loop**";
    }

    state.oracleDecision = decision;
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = reason;
    
    // If CONTINUE, calculate next checkpoint based on intervention plan
    if (decision === 'CONTINUE') {
      if (state.interventionPlan) {
        // Use pre-planned intervention points
        const nextOracle = state.interventionPlan.oracleInterventions.find(i => i > state.iteration);
        if (nextOracle) {
          state.nextCheckpointAt = nextOracle;
          state.checkpointInterval = nextOracle - state.iteration;
        } else {
          state.nextCheckpointAt = state.iteration + 1;
          state.checkpointInterval = 1;
        }
      } else {
        // Fallback to dynamic calculation
        const nextInterval = calculateNextInterval(state);
        state.nextCheckpointAt = state.iteration + nextInterval;
        state.checkpointInterval = nextInterval;
      }
    }
    
    saveState(state);

    const intervalInfo = decision === 'CONTINUE' 
      ? `\n**Next checkpoint:** Iteration ${state.nextCheckpointAt}`
      : '';

    return `**Oracle Decision Recorded**

**Decision:** ${decision}
**Reason:** ${reason || 'Not specified'}
**At:** ${state.oracleDecisionAt}${intervalInfo}

**Builder action:**
${decision === 'CONTINUE' ? '- @luffy_loop command=resume' : ''}
${decision === 'PAUSE' ? '- Wait for user input' : ''}
${decision === 'ADJUST' ? '- Update TODO list, then resume' : ''}
${decision === 'TERMINATE' ? '- @luffy_loop command=terminate' : ''}`;
  },

  getDecision() {
    const state = loadState();
    
    if (!state || !state.active) {
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
      interventionPlan: state.interventionPlan,
      metrics: {
        progressRate: state.progressRate,
        errorRate: state.errorRate,
        convergenceScore: state.convergenceScore
      }
    }, null, 2);
  },

  // =========================================================================
  // STATUS & REVIEW
  // =========================================================================

  status() {
    const state = loadState();
    
    if (!state) {
      return "**Oracle: No Active Loop**\n\nNo loop state found.\n\nStart: @luffy_loop command=start prompt=\"...\"";
    }

    if (!state.active) {
      return "**Oracle: Loop Inactive**\n\nLoop terminated.\n\nStart: @luffy_loop command=start prompt=\"...\"";
    }

    const status = state.paused 
      ? `⏸️ PAUSED at iteration ${state.iteration}`
      : `▶️ Running`;

    const interventionInfo = state.interventionPlan
      ? `\n**Intervention Plan:**
- Total TODOs: ${state.interventionPlan.totalTodos}
- Iterations: ${state.iteration}/${state.interventionPlan.iterationsNeeded}
- Next Oracle review: ${state.interventionPlan.oracleInterventions.find(i => i > state.iteration) || 'None'}
- Next User notification: ${state.interventionPlan.userInterventions.find(i => i > state.iteration) || 'None'}`
      : '';

    const decisionInfo = state.oracleDecision
      ? `\n**Decision:** ${state.oracleDecision}`
      : "";

    const metricsInfo = `
**Metrics:**
- Progress rate: ${(state.progressRate || 0).toFixed(2)} files/iter
- Error rate: ${(state.errorRate || 0).toFixed(2)} errors/iter
- Convergence: ${(state.convergenceScore || 0).toFixed(2)}`;

    return `**Oracle: Monitoring Loop**

**Task:** ${state.prompt.substring(0, 60)}...
**Progress:** ${state.iteration}/${state.maxIterations} (${Math.round((state.iteration/state.maxIterations)*100)}%)
**Status:** ${status}
**Next checkpoint:** ${state.nextCheckpointAt}${interventionInfo}${decisionInfo}${metricsInfo}

**Actions:**
- Delegate to @oracle subagent for review
- Then use: oracle-control action=set_decision`;
  },

  review(task_context?: string) {
    const { decision, reason, nextInterval } = makeDecision(state);
    
    // Write decision to state
    state.oracleDecision = decision;
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = reason;
    
    if (decision === 'CONTINUE' && nextInterval) {
      // Check intervention plan
      if (state.interventionPlan) {
        const nextOracle = state.interventionPlan.oracleInterventions.find(i => i > state.iteration);
        if (nextOracle) {
          state.nextCheckpointAt = nextOracle;
          state.checkpointInterval = nextOracle - state.iteration;
        } else {
          state.nextCheckpointAt = state.iteration + 1;
          state.checkpointInterval = 1;
        }
      } else {
        state.nextCheckpointAt = state.iteration + nextInterval;
        state.checkpointInterval = nextInterval;
      }
    }
    
    saveState(state);

    const metricsSummary = `
**Metrics Analysis:**
- Convergence: ${(state.convergenceScore || 0).toFixed(2)}
- Progress rate: ${(state.progressRate || 0).toFixed(2)} files/iter
- Error rate: ${(state.errorRate || 0).toFixed(2)} errors/iter`;

    const nextInfo = decision === 'CONTINUE'
      ? `\n**Next checkpoint:** Iteration ${state.nextCheckpointAt}`
      : '';

    const todoProgress = state.interventionPlan
      ? `\n**TODO Progress:** ~${Math.round((state.iteration / state.interventionPlan.iterationsNeeded) * state.interventionPlan.totalTodos)}/${state.interventionPlan.totalTodos}`
      : '';

    return `**Oracle: Checkpoint Review**

**Task:** ${state.prompt.substring(0, 60)}...
**Iteration:** ${state.iteration}/${state.maxIterations}${metricsSummary}${todoProgress}
${task_context ? `\n**Context:** ${task_context}` : ''}

---

**Oracle Decision: ${decision}**

**Reason:** ${reason}${nextInfo}

---

**Decision written to state.**
**Builder action:** ${decision === 'CONTINUE' 
  ? '@luffy_loop command=resume' 
  : decision === 'TERMINATE' 
    ? '@luffy_loop command=terminate'
    : 'Wait for user input'}`;
  },

  // =========================================================================
  // PHASE 4: VERIFICATION
  // =========================================================================

  verify() {
    const state = loadState();
    
    if (!state || !state.active) {
      return "**Oracle: No Active Loop**\n\nCannot verify - no active loop.";
    }

    // Calculate completion metrics
    const iterationsComplete = state.iteration >= state.maxIterations;
    const todosComplete = state.interventionPlan 
      ? state.completedTodos.length >= state.interventionPlan.totalTodos
      : false;
    const errorRateAcceptable = (state.errorRate || 0) < 1;
    const convergenceGood = (state.convergenceScore || 0) >= 0.5;
    
    const allChecksPass = iterationsComplete && errorRateAcceptable;
    
    // Update verification status
    state.verificationStatus = allChecksPass ? 'approved' : 'revision_requested';
    saveState(state);

    const summary = `
**Verification Results:**

| Check | Status |
|-------|--------|
| All iterations complete | ${iterationsComplete ? '✅' : '⚠️ ' + state.iteration + '/' + state.maxIterations} |
| Error rate acceptable | ${errorRateAcceptable ? '✅' : '❌ ' + (state.errorRate || 0).toFixed(2)} |
| Convergence | ${convergenceGood ? '✅ ' + (state.convergenceScore || 0).toFixed(2) : '⚠️ ' + (state.convergenceScore || 0).toFixed(2)} |
${state.interventionPlan ? `| TODOs complete | ${todosComplete ? '✅' : '⚠️ ' + state.completedTodos.length + '/' + state.interventionPlan.totalTodos} |` : ''}

**Metrics:**
- Files changed: ${state.metrics.reduce((s, m) => s + m.filesChanged, 0)}
- Files modified: ${state.metrics.reduce((s, m) => s + m.filesModified, 0)}
- Total errors: ${state.metrics.reduce((s, m) => s + m.errorsEncountered, 0)}
`;

    if (allChecksPass) {
      return `**Oracle: Verification Complete** ✅ APPROVED

${summary}

**Status:** APPROVE_COMPLETION

All major checks pass. Task is complete.`;
    } else {
      return `**Oracle: Verification Complete** ⚠️ REVISION NEEDED

${summary}

**Status:** REQUEST_REVISION

**Issues to address:**
${!iterationsComplete ? '- Complete all iterations' : ''}
${!errorRateAcceptable ? '- High error rate needs addressing' : ''}
${!convergenceGood ? '- Low convergence indicates problems' : ''}
${state.interventionPlan && !todosComplete ? '- Not all TODOs completed' : ''}

**Recommendation:** Address issues and re-run, or adjust plan.`;
    }
  },

  // =========================================================================
  // STATE MANAGEMENT - PURGE, RECORD, RETRY
  // =========================================================================

  purgeState() {
    try {
      const absolutePath = path.resolve(STATE_FILE);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
      return "**State Purged** ✅\n\nOld state file has been removed.\n\nReady for new task.";
    } catch (error) {
      return "**State Purged** ✅\n\nNo old state found (or was already clean).";
    }
  },

  recordAttempt(type: 'direct' | 'loop', taskDescription: string) {
    const state = loadState();
    
    const attempt: AttemptRecord = {
      id: Date.now().toString(),
      type,
      task: taskDescription,
      status: 'success',
      completedAt: new Date().toISOString()
    };
    
    // Create state if none exists
    if (!state) {
      const newState = {
        active: false,
        paused: false,
        iteration: 0,
        maxIterations: 10,
        checkpointInterval: 5,
        completionPromise: "DONE",
        prompt: taskDescription,
        startedAt: new Date().toISOString(),
        lastCheckpoint: 0,
        lastIterationAt: "",
        interventionPlan: null,
        taskDecision: 'SIMPLE',
        metrics: [],
        oracleDecision: null,
        oracleDecisionAt: null,
        oracleDecisionReason: null,
        nextCheckpointAt: 5,
        progressRate: 0,
        errorRate: 0,
        convergenceScore: 0,
        completedTodos: [],
        verificationStatus: null,
        errors: [],
        previousAttempts: [attempt],
        terminatedWithReason: null
      };
      saveState(newState);
    } else {
      // Add to previous attempts
      if (!state.previousAttempts) {
        state.previousAttempts = [];
      }
      state.previousAttempts.push(attempt);
      saveState(state);
    }
    
    return `**Attempt Recorded** ✅

**Type:** ${type} (direct execution)
**Task:** ${taskDescription}
**Status:** success

This attempt has been recorded in state.`;
  },

  recordError(iteration: number, errorType: string, errorDescription: string) {
    const state = loadState();
    
    if (!state) {
      return "**Error: No active state**\n\nCannot record error - no state file.";
    }
    
    const error: ErrorRecord = {
      iteration,
      type: errorType,
      description: errorDescription,
      timestamp: new Date().toISOString()
    };
    
    if (!state.errors) {
      state.errors = [];
    }
    state.errors.push(error);
    saveState(state);
    
    return `**Error Recorded** ⚠️

**Iteration:** ${iteration}
**Type:** ${errorType}
**Description:** ${errorDescription}

Error has been recorded in state for future reference.`;
  },

  getPreviousAttempts() {
    const state = loadState();
    
    if (!state || !state.previousAttempts || state.previousAttempts.length === 0) {
      return JSON.stringify({
        hasPreviousAttempts: false,
        message: "No previous attempts found."
      }, null, 2);
    }
    
    return JSON.stringify({
      hasPreviousAttempts: true,
      count: state.previousAttempts.length,
      attempts: state.previousAttempts,
      errors: state.errors || []
    }, null, 2);
  },

  terminateAndClear(remainingCheckpoints: number, reason: string) {
    const state = loadState();
    
    if (!state) {
      return "**Error: No active state**\n\nNothing to terminate.";
    }
    
    // Record the termination
    state.terminatedWithReason = reason;
    state.oracleDecision = 'TERMINATE';
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = `Terminated with ${remainingCheckpoints} checkpoints remaining: ${reason}`;
    
    // Clear remaining checkpoints by setting max to current
    if (state.interventionPlan) {
      state.interventionPlan.oracleInterventions = state.interventionPlan.oracleInterventions.filter(i => i <= state.iteration);
      state.interventionPlan.userInterventions = state.interventionPlan.userInterventions.filter(i => i <= state.iteration);
    }
    
    saveState(state);
    
    return `**Terminated and Cleared** 🛑

**Iteration:** ${state.iteration}/${state.maxIterations}
**Remaining checkpoints cleared:** ${remainingCheckpoints}
**Reason:** ${reason}

State updated. This termination has been recorded for future reference.`;
  }
})
