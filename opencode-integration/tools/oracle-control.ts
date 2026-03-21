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

function getFailurePath(directory: string): string {
  return path.join(directory, "failure.md");
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
    
    let current: LoopState = {} as LoopState;
    try {
      if (fs.existsSync(absolutePath)) {
        current = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
      }
    } catch {
      current = {} as LoopState;
    }
    
    const merged = {
      ...current,
      ...state,
    };
    
    fs.writeFileSync(absolutePath, JSON.stringify(merged, null, 2));
  })();
  
  await writeQueue;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

function loadState(sessionID: string): LoopState | null {
  try {
    const absolutePath = path.resolve(getStateFile(sessionID));
    if (fs.existsSync(absolutePath)) {
      const content = fs.readFileSync(absolutePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    // Ignore
  }
  return null;
}

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
  totalIterations: number;
  oracleCheckpoints: number[];
  userCheckpoints: number[];
  totalTodos?: number;
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

interface Failure {
  id: string;
  iteration: number;
  type: 'user_scold' | 'ai_blunder' | 'disagreement' | 'revert';
  description: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
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
  // Failure tracking
  failures: Failure[];
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
// FAILURE MD GENERATION
// ============================================================================

function generateFailureMd(failures: Failure[], sessionID: string): string {
  const unresolved = failures.filter(f => !f.resolved);
  const resolved = failures.filter(f => f.resolved);
  
  let md = `# Failures Log\n\n`;
  md += `**Session:** ${sessionID}\n\n`;
  
  if (unresolved.length > 0) {
    md += `## ❌ Unresolved (${unresolved.length})\n\n`;
    unresolved.forEach(f => {
      md += `### [❌] ${f.id} | Iter ${f.iteration} | ${f.type}\n`;
      md += `**Issue:** ${f.description}\n`;
      md += `**Created:** ${f.createdAt}\n\n`;
      md += `---\n\n`;
    });
  }
  
  if (resolved.length > 0) {
    md += `## ✅ Resolved (${resolved.length})\n\n`;
    resolved.forEach(f => {
      md += `### [✅] ${f.id} | Iter ${f.iteration} | ${f.type}\n`;
      md += `**Issue:** ~~${f.description}~~\n`;
      md += `**Created:** ${f.createdAt}\n`;
      md += `**Resolved:** ${f.resolvedAt}\n\n`;
      md += `---\n\n`;
    });
  }
  
  if (failures.length === 0) {
    md += `*No failures recorded.*\n`;
  }
  
  return md;
}

function updateFailureMd(directory: string, failures: Failure[], sessionID: string): void {
  try {
    const failurePath = getFailurePath(directory);
    const md = generateFailureMd(failures, sessionID);
    fs.writeFileSync(failurePath, md);
  } catch (error) {
    // Ignore - failure.md is optional
  }
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export default tool({
  description: `Oracle - Strategic controller for Luffy Loop. Manages intervention planning, checkpoint reviews, and verification.

**Actions:**
- set_intervention_plan: Oracle Phase 1 - write intervention plan (totalIterations, checkpoints)
- get_intervention_plan: Read current intervention plan
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
      "set_intervention_plan", "get_intervention_plan",
      "set_decision", "get_decision", "status", "review", "verify",
      "purge_state", "record_attempt", "record_error", "get_previous_attempts", "terminate_and_clear",
      "record_failure", "resolve_failure", "get_failures"
    ]).describe("Action to perform"),
    // set_intervention_plan args
    totalIterations: tool.schema.number().describe("Total iterations (Oracle calculated)"),
    oracleCheckpoints: tool.schema.array(tool.schema.number()).describe("Iterations where Oracle reviews (e.g., [2, 4])"),
    userCheckpoints: tool.schema.array(tool.schema.number()).describe("Iterations where user reviews (e.g., [3, 6])"),
    totalTodos: tool.schema.number().optional().describe("Total TODOs (for tracking only)"),
    // set_decision args
    decision: tool.schema.enum(["CONTINUE", "PAUSE", "ADJUST", "TERMINATE"]).optional()
      .describe("Decision: CONTINUE, PAUSE, ADJUST, or TERMINATE"),
    reason: tool.schema.string().optional().describe("Reason for decision"),
    // review args
    task_context: tool.schema.string().optional().describe("Context for review"),
    // record_attempt args
    attemptType: tool.schema.enum(["direct", "loop"]).optional().describe("Type of attempt"),
    taskDescription: tool.schema.string().optional().describe("Task description"),
    // record_error args
    iteration: tool.schema.number().optional().describe("Iteration where error occurred"),
    errorType: tool.schema.string().optional().describe("Type of error"),
    errorDescription: tool.schema.string().optional().describe("Error description"),
    // terminate_and_clear args
    remainingCheckpoints: tool.schema.number().optional().describe("Remaining checkpoints"),
    // record_failure args
    failureType: tool.schema.enum(["user_scold", "ai_blunder", "disagreement", "revert"]).optional()
      .describe("Type of failure"),
    failureDescription: tool.schema.string().optional().describe("Description of failure"),
    // resolve_failure args
    failureId: tool.schema.string().optional().describe("Failure ID to resolve")
  },

  async execute(args, context) {
    const sessionID = context.sessionID;
    const directory = context.directory;
    const { action, totalIterations, oracleCheckpoints, userCheckpoints, totalTodos, decision, reason, task_context, attemptType, taskDescription, iteration, errorType, errorDescription, remainingCheckpoints } = args;
    
    switch (action) {
      case "set_intervention_plan":
        return this.setInterventionPlan(sessionID, totalIterations, oracleCheckpoints, userCheckpoints, totalTodos);
      case "get_intervention_plan":
        return this.getInterventionPlan(sessionID);
      case "set_decision":
        return this.setDecision(sessionID, decision!, reason || "");
      case "get_decision":
        return this.getDecision(sessionID);
      case "status":
        return this.status(sessionID);
      case "review":
        return this.review(sessionID, task_context);
      case "verify":
        return this.verify(sessionID);
      case "purge_state":
        return this.purgeState(sessionID);
      case "record_attempt":
        return this.recordAttempt(sessionID, attemptType || "direct", taskDescription || "");
      case "record_error":
        return this.recordError(sessionID, directory, iteration || 0, errorType || "unknown", errorDescription || "");
      case "get_previous_attempts":
        return this.getPreviousAttempts(sessionID);
      case "terminate_and_clear":
        return this.terminateAndClear(sessionID, remainingCheckpoints || 0, reason || "User requested");
      case "record_failure":
        return this.recordFailure(sessionID, directory, iteration || 0, failureType as any || "ai_blunder", failureDescription || "");
      case "resolve_failure":
        return this.resolveFailure(sessionID, directory, failureId || "");
      case "get_failures":
        return this.getFailures();
      default:
        return "Unknown action: " + action;
    }
  },

  // =========================================================================
  // PHASE 1: INTERVENTION PLANNING
  // =========================================================================

  setInterventionPlan(sessionID: string, totalIterations: number, oracleCheckpoints: number[], userCheckpoints: number[], totalTodos?: number) {
    let state = loadState(sessionID);
    
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
        taskDecision: null,
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
        previousAttempts: [],
        terminatedWithReason: null,
        failures: []
      };
    }
    
    const plan: InterventionPlan = {
      totalIterations,
      oracleCheckpoints,
      userCheckpoints,
      totalTodos,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    state.interventionPlan = plan;
    state.maxIterations = totalIterations;
    state.nextCheckpointAt = oracleCheckpoints[0] || totalIterations;
    state.checkpointInterval = oracleCheckpoints[0] || 1;
    
    safeWrite(state, sessionID);
    
    return `**Intervention Plan Created**

**Total Iterations:** ${totalIterations}
${totalTodos ? `**Total TODOs:** ${totalTodos}` : ''}

**Oracle Checkpoints:** [${oracleCheckpoints.join(", ")}]
**User Checkpoints:** [${userCheckpoints.join(", ")}]

**Plan written to state.**
**Next:** Builder starts Luffy Loop.`;
  },

  getInterventionPlan(sessionID: string) {
    const state = loadState(sessionID);
    
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
      nextOracleCheckpoint: state.interventionPlan.oracleCheckpoints.find(i => i > state.iteration),
      nextUserCheckpoint: state.interventionPlan.userCheckpoints.find(i => i > state.iteration)
    }, null, 2);
  },

  // =========================================================================
  // CHECKPOINT DECISIONS
  // =========================================================================

  setDecision(sessionID: string, decision: 'CONTINUE' | 'PAUSE' | 'ADJUST' | 'TERMINATE', reason: string) {
    const state = loadState(sessionID);
    
    if (!state || !state.active) {
      return "**Cannot set decision: No active loop**";
    }

    state.oracleDecision = decision;
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = reason;
    
    // If CONTINUE, calculate next checkpoint based on intervention plan
    if (decision === 'CONTINUE') {
      if (state.interventionPlan) {
        const nextOracle = state.interventionPlan.oracleCheckpoints.find(i => i > state.iteration);
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
    
    safeWrite(state, sessionID);

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

  getDecision(sessionID: string) {
    const state = loadState(sessionID);
    
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

  status(sessionID: string) {
    const state = loadState(sessionID);
    
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
- Total Iterations: ${state.interventionPlan.totalIterations}
${state.interventionPlan.totalTodos ? `- Total TODOs: ${state.interventionPlan.totalTodos}` : ''}
- Oracle Checkpoints: [${state.interventionPlan.oracleCheckpoints.join(", ")}]
- User Checkpoints: [${state.interventionPlan.userCheckpoints.join(", ")}]
- Next Oracle: ${state.interventionPlan.oracleCheckpoints.find(i => i > state.iteration) || 'None'}
- Next User: ${state.interventionPlan.userCheckpoints.find(i => i > state.iteration) || 'None'}`
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

  review(sessionID: string, task_context?: string) {
    const state = loadState(sessionID);
    
    if (!state || !state.active) {
      return "**Cannot review: No active loop**";
    }
    
    const { decision, reason, nextInterval } = makeDecision(state);
    
    // Write decision to state
    state.oracleDecision = decision;
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = reason;
    
    if (decision === 'CONTINUE' && nextInterval) {
      if (state.interventionPlan) {
        const nextOracle = state.interventionPlan.oracleCheckpoints.find(i => i > state.iteration);
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
    
    safeWrite(state, sessionID);

    const metricsSummary = `
**Metrics Analysis:**
- Convergence: ${(state.convergenceScore || 0).toFixed(2)}
- Progress rate: ${(state.progressRate || 0).toFixed(2)} files/iter
- Error rate: ${(state.errorRate || 0).toFixed(2)} errors/iter`;

    const nextInfo = decision === 'CONTINUE'
      ? `\n**Next checkpoint:** Iteration ${state.nextCheckpointAt}`
      : '';

    const todoProgress = state.interventionPlan && state.interventionPlan.totalTodos
      ? `\n**TODO Progress:** ~${Math.round((state.iteration / state.interventionPlan.totalIterations) * state.interventionPlan.totalTodos)}/${state.interventionPlan.totalTodos}`
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

  verify(sessionID: string) {
    const state = loadState(sessionID);
    
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
    safeWrite(state, sessionID);

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

  purgeState(sessionID: string) {
    try {
      const absolutePath = path.resolve(getStateFile(sessionID));
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
      return "**State Purged** ✅\n\nOld state file has been removed.\n\nReady for new task.";
    } catch (error) {
      return "**State Purged** ✅\n\nNo old state found (or was already clean).";
    }
  },

  recordAttempt(sessionID: string, type: 'direct' | 'loop', taskDescription: string) {
    const state = loadState(sessionID);
    
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
        terminatedWithReason: null,
        failures: []
      };
      safeWrite(newState, sessionID);
    } else {
      // Add to previous attempts
      if (!state.previousAttempts) {
        state.previousAttempts = [];
      }
      state.previousAttempts.push(attempt);
      safeWrite(state, sessionID);
    }
    
    return `**Attempt Recorded** ✅

**Type:** ${type} (direct execution)
**Task:** ${taskDescription}
**Status:** success

This attempt has been recorded in state.`;
  },

  recordError(sessionID: string, directory: string, iteration: number, errorType: string, errorDescription: string) {
    const state = loadState(sessionID);
    
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
    safeWrite(state, sessionID);
    
    return `**Error Recorded** ⚠️

**Iteration:** ${iteration}
**Type:** ${errorType}
**Description:** ${errorDescription}

Error has been recorded in state for future reference.`;
  },

  getPreviousAttempts(sessionID: string) {
    const state = loadState(sessionID);
    
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

  terminateAndClear(sessionID: string, remainingCheckpoints: number, reason: string) {
    const state = loadState(sessionID);
    
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
      state.interventionPlan.oracleCheckpoints = state.interventionPlan.oracleCheckpoints.filter(i => i <= state.iteration);
      state.interventionPlan.userCheckpoints = state.interventionPlan.userCheckpoints.filter(i => i <= state.iteration);
    }
    
    safeWrite(state, sessionID);
    
    return `**Terminated and Cleared** 🛑

**Iteration:** ${state.iteration}/${state.maxIterations}
**Remaining checkpoints cleared:** ${remainingCheckpoints}
**Reason:** ${reason}

State updated. This termination has been recorded for future reference.`;
  },

  // =========================================================================
  // FAILURE TRACKING
  // =========================================================================

  recordFailure(sessionID: string, directory: string, iteration: number, type: 'user_scold' | 'ai_blunder' | 'disagreement' | 'revert', description: string) {
    let state = loadState(sessionID);
    
    // Create state if none exists
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
        taskDecision: null,
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
        previousAttempts: [],
        terminatedWithReason: null,
        failures: []
      };
    }
    
    const failure: Failure = {
      id: `fail-${Date.now()}`,
      iteration,
      type,
      description,
      resolved: false,
      resolvedAt: null,
      createdAt: new Date().toISOString()
    };
    
    if (!state.failures) {
      state.failures = [];
    }
    state.failures.push(failure);
    safeWrite(state, sessionID);
    
    // Generate failure.md in project directory
    updateFailureMd(directory, state.failures, sessionID);
    
    return `**Failure Recorded** ⚠️

**ID:** ${failure.id}
**Type:** ${type}
**Iteration:** ${iteration}
**Description:** ${description}

**Total Failures:** ${state.failures.length}
**Unresolved:** ${state.failures.filter(f => !f.resolved).length}

**failure.md updated in:** ${directory}`;
  },

  resolveFailure(sessionID: string, directory: string, failureId: string) {
    const state = loadState(sessionID);
    
    if (!state || !state.failures) {
      return "**Error: No failures found**\n\nNo state or failures to resolve.";
    }
    
    const failure = state.failures.find(f => f.id === failureId);
    if (!failure) {
      return `**Error: Failure ${failureId} not found**\n\nAvailable: ${state.failures.map(f => f.id).join(', ')}`;
    }
    
    failure.resolved = true;
    failure.resolvedAt = new Date().toISOString();
    safeWrite(state, sessionID);
    
    const unresolvedCount = state.failures.filter(f => !f.resolved).length;
    
    safeWrite(state, sessionID);
    
    // Update failure.md in project directory
    updateFailureMd(directory, state.failures, sessionID);
    
    return `**Failure Resolved** ✅

**ID:** ${failureId}
**Resolved At:** ${failure.resolvedAt}

**Total Failures:** ${state.failures.length}
**Unresolved:** ${unresolvedCount}
${unresolvedCount === 0 ? '\n🎉 All failures resolved!' : ''}

**failure.md updated in:** ${directory}`;
  },

  getFailures(sessionID: string) {
    const state = loadState(sessionID);
    
    if (!state || !state.failures || state.failures.length === 0) {
      return JSON.stringify({
        total: 0,
        unresolved: 0,
        failures: [],
        message: "No failures recorded"
      }, null, 2);
    }
    
    const failures = state.failures.map(f => ({
      ...f,
      status: f.resolved ? 'resolved' : 'unresolved'
    }));
    
    return JSON.stringify({
      total: failures.length,
      unresolved: failures.filter(f => !f.resolved).length,
      resolved: failures.filter(f => f.resolved).length,
      failures
    }, null, 2);
  }
})
