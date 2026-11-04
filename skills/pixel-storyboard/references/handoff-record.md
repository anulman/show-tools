# Preserve the current decision across agents

Keep one small record beside the active work. Use existing project metadata when it supplies the same facts. This is a handoff shape, not a new runtime format.

```yaml
action: Maestro runs right, falls through the air and lands face-first
stage: held-pose review
owner:
  source_art: Video Art
  scene_and_timing: Director 11
sources:
  model: approved edition and Figma node
  poses: current component IDs and drawing hashes
  registration: common canvas, scale, floor and per-pose offsets
decisions:
  pose_and_action:
    operator: approved
    version: pose baseline
  identity_and_face:
    reviewer: pass
    operator: awaiting acceptance of the polished version
    version: current drawing hashes
  pixel_finish:
    reviewer: pass
    version: current drawing hashes
  timing_and_tweens:
    operator: review requested
    version: timeline and MP4 hash
  runtime_promotion: not requested
change_scope:
  permitted: facial RGB pixels inside named regions
  fixed: alpha, outer silhouettes, body, props, effects and transforms
evidence:
  visual: before-and-after crops and actual placed view
  scope: full outside-region RGBA and alpha comparisons
  export: current canonical export receipt
next_decision: identify which pose pair needs an interim
```

Store exact IDs and hashes in the actual record. The values above demonstrate the shape. Do not copy them as approvals for another action.

A handoff message needs the current task, owner, permitted change, immutable items, artifact path and next judgment. Link the record rather than resending every old report. Report a concrete blocker when work cannot proceed. Progress messages should state a new finding, completed decision or changed plan.

An internal pass does not fill an operator-acceptance field. Export equality does not fill an artistic-review field. New artwork invalidates reviews of the changed artwork. A new timeline invalidates the old motion-export review. Preserve decisions for unchanged scope rather than reopening the entire action.

For authorized autonomous work, record internal decisions and keep operator acceptance as unreviewed until the operator sees that version. An unreviewed operator field does not itself require a pause. Record whether the requested deliverable is a review study or a finished animation.
