import { tool } from "@opencode-ai/plugin"
import fs from "fs";
import path from "path";

const STATE_FILE = path.join(
  process.env.HOME || "~",
  ".config/opencode/.state/luffy-loop.json"
);

// Extended state interface (mirrors luffy-loop.ts)
interface IterationMetrics {
  filesChanged: number;
  filesModified: number;
  errorsEncountered: number;
  testsPassed: number;
  testsFailed: number;
  iterationDuration: number;
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
  // Dynamic checkpoint fields
  metrics: IterationMetrics[];
  oracleDecision: 'CONTINUE' | 'PAUSE' | 'TERMINATE' | null;
  oracleDecisionAt: string | null;
  oracleDecisionReason: string | null;
  nextCheckpointAt: number;
  progressRate: number;
  errorRate: number;
  convergenceScore: number;
}

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

// Calculate next interval based on convergence
function calculateNextInterval(state: LoopState): number {
  const { progressRate, errorRate, convergenceScore } = state;
  
  if (convergenceScore > 2) return 7;
  if (convergenceScore >= 1) return 5;
  if (convergenceScore >= 0.5) return 3;
  if (progressRate > 0) return 2;
  return 1;
}

// Make decision based on metrics
function makeDecision(state: LoopState): {
  decision: 'CONTINUE' | 'PAUSE' | 'TERMINATE';
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

export default tool({
  description: "Oracle - Strategic controller for Luffy Loop. Reviews progress, controls iterations, decides continue/pause/terminate.",

  args: {
    action: tool.schema.enum(["status", "review", "query_librarian", "recommend"])
      .describe("Action: status, review, query_librarian, recommend"),
    task_context: tool.schema.string()
      .describe("Context for review or observations"),
    recommendation: tool.schema.enum(["continue", "pause", "terminate"])
      .describe("Recommendation: continue, pause, or terminate"),
    query_type: tool.schema.enum(["bias_check", "strategy", "progress", "cost"])
      .describe("Librarian query type")
  },

  async execute(args) {
    const { action, task_context, recommendation, query_type } = args;
    
    switch (action) {
      case "status":
        return this.status();
      case "review":
        return this.review();
      case "query_librarian":
        return this.queryLibrarian(task_context, query_type);
      case "recommend":
        return this.recommend(recommendation, task_context);
      default:
        return "Unknown action: " + action;
    }
  },

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
**Next checkpoint:** ${state.nextCheckpointAt}${decisionInfo}${metricsInfo}

**Actions:**
- @oracle action=review
- @oracle action=recommend recommendation=continue|pause|terminate`;
  },

  review() {
    const state = loadState();
    
    if (!state || !state.active) {
      return "**Oracle: No Active Loop**\n\nCannot review - no active loop.";
    }

    // Use metrics-based decision
    const { decision, reason, nextInterval } = makeDecision(state);
    
    // Write decision to state
    state.oracleDecision = decision;
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = reason;
    
    if (decision === 'CONTINUE' && nextInterval) {
      state.nextCheckpointAt = state.iteration + nextInterval;
      state.checkpointInterval = nextInterval;
    }
    
    saveState(state);

    const metricsSummary = `
**Metrics Analysis:**
- Convergence: ${(state.convergenceScore || 0).toFixed(2)}
- Progress rate: ${(state.progressRate || 0).toFixed(2)} files/iter
- Error rate: ${(state.errorRate || 0).toFixed(2)} errors/iter`;

    const nextInfo = decision === 'CONTINUE'
      ? `\n**Next checkpoint:** Iteration ${state.nextCheckpointAt} (interval: ${state.checkpointInterval})`
      : '';

    return `**Oracle: Checkpoint Review**

**Task:** ${state.prompt.substring(0, 60)}...
**Iteration:** ${state.iteration}/${state.maxIterations}${metricsSummary}

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

  queryLibrarian(task_context, query_type) {
    return "**Oracle: Research Request**\n\nQuery: " + (task_context || "Research needed") + "\nType: " + (query_type || "general") + "\n\n@librarian \"" + (task_context || "Research this topic") + "\"";
  },

  recommend(recommendation, task_context) {
    const state = loadState();
    
    if (!state || !state.active) {
      return "**Oracle: No Active Loop**\n\nCannot recommend - no active loop.";
    }

    const rec = (recommendation || "continue").toUpperCase() as 'CONTINUE' | 'PAUSE' | 'TERMINATE';
    const reason = task_context || "Manual Oracle recommendation";
    
    // Write decision to state
    state.oracleDecision = rec;
    state.oracleDecisionAt = new Date().toISOString();
    state.oracleDecisionReason = reason;
    
    if (rec === 'CONTINUE') {
      const nextInterval = calculateNextInterval(state);
      state.nextCheckpointAt = state.iteration + nextInterval;
      state.checkpointInterval = nextInterval;
    }
    
    saveState(state);

    const nextInfo = rec === 'CONTINUE'
      ? `\n**Next checkpoint:** Iteration ${state.nextCheckpointAt} (interval: ${state.checkpointInterval})`
      : '';

    return `**Oracle: Decision Set**

**Decision:** ${rec}
**Reason:** ${reason}${nextInfo}

**Decision written to state.**

**Builder action:**
${rec === 'CONTINUE' ? '- @luffy_loop command=resume' : ''}
${rec === 'PAUSE' ? '- Wait for user input, then @luffy_loop command=resume when ready' : ''}
${rec === 'TERMINATE' ? '- @luffy_loop command=terminate' : ''}`;
  }
})
