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
      return "**Oracle: Monitoring Active**\n\nNo active loop.\n\nStart: @luffy_loop command=start prompt=\"...\"";
    }

    if (!state.active) {
      return "**Oracle: No Active Loop**\n\nLoop terminated.\n\nStart: @luffy_loop command=start prompt=\"...\"";
    }

    const status = state.paused 
      ? "PAUSED at checkpoint " + state.lastCheckpoint + " - Awaiting Oracle"
      : "Running - Oracle monitoring";

    const action = state.paused && state.lastCheckpoint > 0
      ? "\n\nOracle Action Required:\nRun @oracle action=review"
      : "\n\nOracle will review at next checkpoint.";

    return "**Oracle: Monitoring Loop**\n\nTask: " + state.prompt.substring(0, 50) + "...\nIteration: " + state.iteration + "/" + state.maxIterations + "\nCheckpoint: " + state.lastCheckpoint + "\nStatus: " + status + action + "\n\nOracle:\n- Stops wrong direction\n- Terminates wasteful loops\n- Escalates when uncertain";
  },

  review() {
    const state = loadState();
    
    if (!state) {
      return "**Oracle: No Loop**\n\nNo active loop to review.";
    }

    if (!state.active) {
      return "**Oracle: Loop Ended**\n\nThis loop has already terminated.";
    }

    const progressPercent = Math.round((state.iteration / state.maxIterations) * 100);
    const iterationsSinceCheckpoint = state.iteration - state.lastCheckpoint;
    const isFirstCheckpoint = state.lastCheckpoint === 0;

    let decision = "";
    let reasoning = "";
    let escalate = false;

    if (isFirstCheckpoint) {
      decision = "CONTINUE";
      reasoning = "First checkpoint - continue to gather metrics.";
    } else if (iterationsSinceCheckpoint > state.checkpointInterval * 2) {
      decision = "TERMINATE";
      reasoning = "Loop stalled - no progress. Wasting tokens.";
      escalate = true;
    } else if (progressPercent >= 50 && iterationsSinceCheckpoint <= 2) {
      decision = "TERMINATE";
      reasoning = "50%+ progress, minimal recent work.";
    } else if (progressPercent >= 75) {
      decision = "CONTINUE";
      reasoning = "Good progress - nearing completion.";
    } else if (progressPercent >= 25) {
      decision = "CONTINUE";
      reasoning = "Decent progress - continue monitoring.";
    } else {
      decision = "ESCALATE";
      reasoning = "Progress unclear - need user input.";
      escalate = true;
    }

    if (escalate) {
      return "**Oracle: Checkpoint Review**\n\nTask: " + state.prompt.substring(0, 60) + "...\nIteration: " + state.iteration + "/" + state.maxIterations + " (" + progressPercent + "%)\nCheckpoint: " + state.lastCheckpoint + "\nStatus: " + (state.paused ? "Paused" : "Running") + "\n\n---\n\n**Oracle Decision: " + decision + "**\n\nReasoning: " + reasoning + "\n\n---\n\n**ORACLE STRUGGLING**\n\nCannot decide confidently. The loop may be:\n- Going wrong direction\n- No meaningful progress\n- Requiring human judgment\n\n**User Must Decide:**\n1. @oracle action=recommend recommendation=continue\n2. @oracle action=recommend recommendation=pause\n3. @oracle action=recommend recommendation=terminate";
    }

    return "**Oracle: Checkpoint Review**\n\nTask: " + state.prompt.substring(0, 60) + "...\nIteration: " + state.iteration + "/" + state.maxIterations + " (" + progressPercent + "%)\nCheckpoint: " + state.lastCheckpoint + "\nStatus: " + (state.paused ? "Paused" : "Running") + "\n\n---\n\n**Oracle Decision: " + decision + "**\n\nReasoning: " + reasoning + "\n\n---\n\n**Finalize:**\n@oracle action=recommend recommendation=" + decision.toLowerCase();
  },

  queryLibrarian(task_context, query_type) {
    return "**Oracle: Research Request**\n\nQuery: " + (task_context || "Research needed") + "\nType: " + (query_type || "general") + "\n\n@librarian \"" + (task_context || "Research this topic") + "\"";
  },

  recommend(recommendation, task_context) {
    const state = loadState();
    const rec = recommendation || "continue";
    
    if (!state) {
      return "**Oracle: No Loop**\n\nCannot finalize - no active loop.";
    }

    if (rec === "continue") {
      return "**Oracle: DECISION - CONTINUE**\n\nFinal: CONTINUE\nRationale: " + (task_context || "Oracle approved continuation.") + "\n\nAction: @luffy_loop command=resume\n\nNote: Oracle will review at next checkpoint.";
    }
    
    if (rec === "pause") {
      return "**Oracle: DECISION - PAUSE**\n\nFinal: PAUSE\nRationale: " + (task_context || "Oracle requires clarification.") + "\n\nAction: @luffy_loop command=pause\n\nDiscuss with user, then resume when ready.";
    }
    
    if (rec === "terminate") {
      return "**Oracle: DECISION - TERMINATE**\n\nFinal: TERMINATE\nRationale: " + (task_context || "Loop not viable - stopping.") + "\n\nAction: @luffy_loop command=terminate\n\nReasons:\n- No meaningful progress\n- Or wrong direction\n- Free tier protection\n\nConsider re-scoped approach if needed.";
    }
    
    return "Unknown decision: " + rec;
  }
})
