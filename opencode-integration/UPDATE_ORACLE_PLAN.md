# Update Oracle.md - Strategic Intervention Planning

## Overview
Update oracle.md to reflect the correct flow: Oracle analyzes → decides strategy → feeds formula to tool → tool calculates and stores

## Current Issues to Fix

1. Flow is backwards - tool calculates, Oracle follows
2. No clarity on who decides todosPerIteration
3. No clarity on formula purpose (cost control)

## Research-Backed Flow

Based on research:
- LLM does strategic analysis
- Tool handles precise calculations
- This controls LLM inference costs

## Changes Required

### Phase 1: Add Strategic Planning Section

Add new section explaining:

```
## Strategic Intervention Planning

### The Flow:
1. Oracle reads IMPLEMENTATION_PLAN.md → counts TODOs: n
2. Oracle analyzes task complexity
3. Oracle decides: todosPerIteration (based on complexity)
4. Oracle feeds formula to tool: n / todosPerIteration
5. Tool calculates: iterations = ceil(n / todosPerIteration)
6. Oracle decides: checkpoint positions for those iterations
7. Tool stores: complete intervention plan

### Why Formula?
- Controls LLM inference cost
- Tool handles math accurately (research: tool-augmented LLMs outperform pure reasoning)
- LLM focuses on strategic analysis only
```

### Phase 2: Update Examples

Show example calls with all parameters:

```
# Oracle decides strategy, tool calculates
oracle-control action=set_intervention_plan 
  totalTodos=15 
  todosPerIteration=3
  oracleInterventions=[2, 4]
  userInterventions=[5]
```

### Phase 3: Clarify Decision Authority

| What | Who Decides |
|------|-------------|
| Task complexity | Oracle (LLM analysis) |
| todosPerIteration | Oracle (based on complexity) |
| Formula calculation | Tool (accurate math) |
| Checkpoint positions | Oracle (strategic) |
| Store/track | Tool |

## Success Criteria
- [ ] Flow clearly shows Oracle decides → Tool calculates
- [ ] Purpose of formula is explained (cost control)
- [ ] Examples show full parameter usage
- [ ] Decision authority is clear

---

**Created by Planner**
**Implementation to be done by Builder**
