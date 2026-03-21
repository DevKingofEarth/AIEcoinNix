# Oracle Problem Analysis - Implementation Plan

## User Request (Exact Prompt)

"no, lets break this problem we have. first how oracle decides the complexity, and how it splits the tasks per iteration. Rest of them seem to have already made, we just have to adapt oracle-control by getting rid of iteration calculation"

### Builder Translation
From the above, Builder should:
- Update oracle.md to define how Oracle analyzes problem complexity
- Update oracle.md to define how Oracle decides task splits per iteration
- Remove iteration calculation from oracle-control.ts (Oracle decides everything)
- Oracle writes complete plan to state, tool just stores it

---

## Phase 1: Oracle Problem Analysis

### What Oracle Does

When analyzing IMPLEMENTATION_PLAN.md:

```
1. READ: Count TODOs from plan
2. ANALYZE: Determine problem type and complexity
3. DECIDE: Split strategy based on analysis
4. WRITE: Complete plan to state (iterations, checkpoints)
```

### Problem Type Recognition

Oracle analyzes the plan and recognizes:

| Problem Type | Indicators | Split Strategy |
|-------------|------------|-----------------|
| **Sequential** | Steps must happen in order, dependencies | Even splits, checkpoint each phase |
| **Independent** | Tasks don't depend on each other | Larger batches, fewer checkpoints |
| **Constraint** | Has explicit constraints, requirements, validations | Checkpoint per constraint |
| **Recursive** | Nested tasks, sub-plans | Checkpoint at depth levels |
| **Experimental** | Trial-and-error, testing phases | Small batches, frequent reviews |

### Complexity Levels

| Level | TODOs | Characteristics | Split |
|-------|-------|-----------------|-------|
| **Trivial** | 1-2 | Quick fix, one-liner | Direct execution, no loop |
| **Simple** | 3-5 | Few steps, low risk | 2-3 TODOs/iter, 1-2 checkpoints |
| **Medium** | 6-12 | Multiple phases, moderate risk | 3-4 TODOs/iter, 2-3 checkpoints |
| **Complex** | 13-25 | Many phases, high risk | 2-3 TODOs/iter, 3-4 checkpoints |
| **Epic** | 25+ | Very large, uncertain | 1-2 TODOs/iter, 4+ checkpoints |

### Split Decision Matrix

Oracle considers:

1. **Task structure**: Sequential? Independent? Nested?
2. **Risk level**: High-risk tasks need more checkpoints
3. **User involvement**: When does user need to review?
4. **Dependencies**: What must complete before what?

Oracle decides:
- `totalIterations`: How many iterations
- `oracleCheckpoints`: [iterations where Oracle reviews]
- `userCheckpoints`: [iterations where user reviews]
- `focus`: What to focus on in each iteration

---

## Phase 2: Oracle.md Changes

### New Section: Problem Analysis

Add to oracle.md:

```markdown
## PROBLEM ANALYSIS

When Builder delegates to you with IMPLEMENTATION_PLAN.md:

### Step 1: Count TODOs

Extract all TODOs from the plan file.
Total TODOs = base for all decisions.

### Step 2: Analyze Problem Type

Look at the plan structure:

| Type | Look For | Strategy |
|------|----------|----------|
| Sequential | Phase numbers, "then", "after" | Even splits, phase boundaries |
| Independent | Bullets, no dependencies | Larger batches |
| Constraint | "must", "ensure", "validate" | Checkpoint per constraint |
| Recursive | Nested lists, sub-tasks | Depth-based checkpoints |

### Step 3: Assess Complexity

Based on TODO count + problem type:

| TODOs | Complexity | TODOs/Iter | Checkpoints |
|-------|------------|-------------|-------------|
| 1-2 | Trivial | Direct | None |
| 3-5 | Simple | 2-3 | 1-2 |
| 6-12 | Medium | 3-4 | 2-3 |
| 13-25 | Complex | 2-3 | 3-4 |
| 25+ | Epic | 1-2 | 4+ |

### Step 4: Decide Splits

Consider:
- Risk areas (high-risk = more checkpoints)
- User involvement points
- Natural phase boundaries
- Dependency chains

Decide:
```
totalIterations: [number you calculate]
oracleCheckpoints: [specific iterations]
userCheckpoints: [specific iterations]
```

### Step 5: Write Complete Plan

Call oracle-control with COMPLETE plan:

```
oracle-control action=set_intervention_plan
  totalIterations=6
  oracleCheckpoints=[2, 4]
  userCheckpoints=[3, 6]
```

Tool stores what Oracle decides - no calculation.
```

---

## Phase 3: oracle-control.ts Changes

### Remove Iteration Calculation

Current (WRONG):
```typescript
const iterationsNeeded = Math.ceil(totalTodos / todosPerIteration);
```

New (Oracle decides):
```typescript
// Oracle provides totalIterations directly
// Tool just stores what Oracle decides
const totalIterations: number;  // Oracle calculated this
```

### New Action: set_intervention_plan

```typescript
setInterventionPlan(
  totalIterations: number,           // Oracle calculated
  oracleCheckpoints: number[],        // Oracle decided
  userCheckpoints: number[],          // Oracle decided
  totalTodos?: number                 // Optional, for tracking only
)
```

### State Schema Update

```typescript
interface InterventionPlan {
  totalIterations: number;           // Oracle's calculated value
  oracleCheckpoints: number[];       // [2, 4] - Oracle decided
  userCheckpoints: number[];        // [3, 6] - Oracle decided
  totalTodos?: number;               // For tracking only
  createdAt: string;
  updatedAt: string;
}
```

### Remove Old Fields

- [ ] Remove `totalTodos` as primary field (now optional)
- [ ] Remove `todosPerIteration` calculation
- [ ] Remove `iterationsNeeded` calculation
- [ ] Keep `totalIterations` (Oracle provides)

---

## Implementation Steps

### Step 1: Update oracle.md
- [ ] Add "Problem Analysis" section
- [ ] Add problem type recognition guide
- [ ] Add complexity level matrix
- [ ] Add split decision guidance
- [ ] Update example calls

### Step 2: Update oracle-control.ts
- [ ] Remove `totalTodos` required field
- [ ] Remove `todosPerIteration` field
- [ ] Add `totalIterations` (required)
- [ ] Rename `oracleInterventions` → `oracleCheckpoints`
- [ ] Rename `userInterventions` → `userCheckpoints`
- [ ] Remove calculation logic
- [ ] Update schema
- [ ] Build tool

### Step 3: Update luffy-loop.ts
- [ ] Update field references (interventions → checkpoints)
- [ ] Update logic for new field names
- [ ] Build tool

### Step 4: Sync to home config
- [ ] Copy updated files to ~/.config/opencode/
- [ ] Build tools in home config

---

## Files to Modify

| File | Changes |
|------|---------|
| `oracle.md` | Add Problem Analysis section with guidance |
| `oracle-control.ts` | Remove calculation, Oracle provides all values |
| `luffy-loop.ts` | Update field names (minor) |

---

## Success Criteria

- [ ] Oracle analyzes problem type from IMPLEMENTATION_PLAN.md
- [ ] Oracle decides complexity level
- [ ] Oracle decides splits (not tool)
- [ ] Oracle writes complete plan to state
- [ ] oracle-control stores without calculating

---

**Created by Planner**

**Implementation to be done by Builder**
