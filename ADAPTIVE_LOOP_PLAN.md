# Adaptive Luffy Loop - Implementation Plan

## User Request (Exact Prompt)

"I guess total tods are regardless for oracle-control, it only records iterations and other things, in each iteration where builder gets signal of delegation via state and delagates oracle, at checkpoint where it has to look, it sees if those iterations did what necessarly needed, like intermediate result recognition, and then at checkpoint it believes it is appropriate for me to take a look, it uses question tool, which I will answer after I review the actions, and then after each intervention, oracle decides, analyses, report builder or like update the state about what to do, builder should be using luffy to first check the state after every intervention and do as decision is written by oracle, by itself or on my behalf. By keeping oracle adaptive, we need to also adapt oracle-control to be able to write state accurately as oracle suggests, and builder reads the states, acts on it, and then update the state about iteration, at checkpoints, as builder reaches there, I mean all updates are editing process, so on arriving on what not edited if that is a checkpoint, it delegates oracle, and then oracle sees everything, if good it will change the state about what to do for builder and then builder does it and then updates the state, so we have two editors for different purposes, one is a torch, that also verifies after the path is followed by builder, and builder bob, would be the editor of state who confirms that they walked towards that light."

### Builder Translation
From the above, Builder should:
- Use luffy-loop to check state after every intervention
- Read Oracle's decisions from state and act on them
- Update state after completing actions
- Delegate to Oracle at checkpoints for direction
- Confirm alignment with planned path

## Overview

This plan implements an **adaptive checkpoint system** where:
- **Oracle** = Strategic torch that illuminates path, analyzes progress, decides direction
- **Builder** = State editor who confirms they followed Oracle's guidance
- **State** = Shared document with two editors (Oracle for direction, Builder for confirmation)
- **Checkpoints** = Triggered by intermediate result recognition, not fixed iterations

## Core Architecture

### State as Shared Document

```
State Fields (Oracle edits):
├── oracleDecision: What to do next
├── decisionReason: Why Oracle decided this
├── nextDirection: Strategic guidance
├── checkpointReason: Why this is a checkpoint
└── alignmentCheck: What to verify

State Fields (Builder edits):
├── iterationProgress: What was completed this iteration
├── alignmentStatus: Did we follow Oracle's direction?
├── currentBlock: Current work block being executed
└── confirmationNotes: Builder's notes on execution
```

### Two-Editor Pattern

| Editor | Purpose | When |
|--------|---------|------|
| **Oracle** | Torch - illuminates direction | At checkpoints |
| **Builder** | Confirmator - confirms walking towards light | After Oracle decides |

### Checkpoint Recognition

Checkpoints trigger when:
1. Builder reaches iteration boundary OR
2. State shows alignment issue OR
3. Oracle flagged a review point

## Implementation Steps

### Phase 1: Redesign State Structure

- [ ] Add new state fields for two-editor pattern
- [ ] Separate Oracle decisions from Builder confirmations
- [ ] Add alignment check fields

### Phase 2: Update oracle-control.ts

- [ ] Add `set_direction` action (Oracle writes what to do)
- [ ] Add `confirm_alignment` action (Builder confirms execution)
- [ ] Add `check_alignment` function (Builder asks: did we follow direction?)
- [ ] Update state schema to support two-editor pattern

### Phase 3: Update luffy-loop.ts

- [ ] Add `get_direction` command (Builder reads Oracle's decision)
- [ ] Add `confirm_iteration` command (Builder updates progress)
- [ ] Check alignment at each iterate

### Phase 4: Update oracle.md

- [ ] Remove fixed todosPerIteration focus
- [ ] Add checkpoint recognition based on intermediate results
- [ ] Add "Oracle as Torch" section
- [ ] Add Oracle decision flow: analyze → decide direction → write to state
- [ ] Add alignment verification at checkpoints

### Phase 5: Update builder.md

- [ ] Add "Builder as Editor" section
- [ ] Show flow: check state → read direction → execute → confirm
- [ ] Add alignment check before delegating
- [ ] Add confirmation update after each action

### Phase 6: Test & Refine

- [ ] Test checkpoint recognition
- [ ] Test two-editor state updates
- [ ] Verify alignment checking works

## Key Changes

### oracle.md - New Sections

```
## ORACLE AS TORCH

You illuminate the path. At checkpoints:
1. Builder reaches checkpoint → delegates to you
2. You read state (what Builder did)
3. You analyze: Did we follow direction? Is progress good?
4. You decide: CONTINUE, ADJUST, PAUSE
5. You write direction to state (torch illuminates next step)

## CHECKPOINT RECOGNITION

A checkpoint is when:
- Builder completed a work block
- State shows potential misalignment
- You flagged a review point
- Iteration boundary reached

At checkpoint, ask:
- Did we produce what was expected?
- Is alignment with plan maintained?
- Any course correction needed?
```

### builder.md - New Sections

```
## BUILDER AS EDITOR

You confirm you walked towards the light.
1. Before work: @luffy_loop get_direction
2. Read Oracle's decision from state
3. Execute work following direction
4. @luffy_loop confirm_iteration
5. Update state with what was done

## ALIGNMENT CHECK

Before delegating to Oracle:
@luffy_loop check_alignment

This verifies:
- Did we follow Oracle's last direction?
- Is progress aligned with plan?
```

## State Schema (Two-Editor)

```typescript
interface LoopState {
  // Oracle (Torch) edits these
  oracleDecision: 'CONTINUE' | 'ADJUST' | 'PAUSE' | 'TERMINATE' | null;
  decisionReason: string | null;
  nextDirection: string | null;  // Strategic guidance
  checkpointReason: string | null;  // Why this is checkpoint
  alignmentRequired: string[];  // What to verify at checkpoint

  // Builder (Editor) edits these
  iterationProgress: {
    completed: string[];
    inProgress: string | null;
    alignmentStatus: 'aligned' | 'misaligned' | 'partial';
  };
  confirmationNotes: string | null;

  // Shared
  iteration: number;
  active: boolean;
  paused: boolean;
}
```

## Tools Flow

```
Builder: @luffy_loop iterate
    ↓
Luffy: Check if checkpoint (alignment issue OR iteration boundary)
    ↓
If checkpoint:
    ↓
Builder: @luffy_loop get_direction  (read Oracle's previous decision)
Builder: Delegate to @oracle
    ↓
Oracle: Analyzes, decides direction, writes to state
    ↓
Builder: @luffy_loop get_direction  (read new Oracle decision)
Builder: Execute following direction
Builder: @luffy_loop confirm_iteration  (update state)
Builder: @luffy_loop iterate  (continue)
```

## Files to Modify

| File | Changes |
|------|---------|
| `oracle-control.ts` | Add set_direction, confirm_alignment actions |
| `luffy-loop.ts` | Add get_direction, confirm_iteration commands |
| `oracle.md` | Add Torch/Editor concept, checkpoint recognition |
| `builder.md` | Add confirmation flow, alignment check |

---

**Created by Planner**

**Implementation to be done by Builder**
