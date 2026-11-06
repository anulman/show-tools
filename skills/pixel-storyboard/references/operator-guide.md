# Direct a character action through storyboards and tweening

A storyboard shows the meaningful drawings. An animatic plays those drawings in time. Tweening adds drawings between two poses so the action reads correctly. Start with the beginning and ending, then split the gaps that need explanation.

The agent owns that sequence even when your request is "animate the whole fall." You can review each decision or authorize the agent to continue through them. You do not need to write a separate prompt for every production step.

## Establish the shot

Name the character, intended action, scene, travel direction and starting state. Point to an approved model or current Figma view when one exists. Describe the result you want the viewer to read.

For example:

> Maestro runs left to right, loses balance, falls through the air and lands face-first in the snow. Keep the approved compact model. Use the current snow scene.

For a scene study, state the framing and what should be discernible in each shot. A distant snowglobe can contain a dot. A closer view can reveal Maestro. The interior view can show his full model. Ask for effect variants as separate cels, such as the same shot with and without snowfall.

The agent resolves the source artwork and keeps the world, actors, props, snow and effects separately editable in Figma.

## Review the start and end before the interims

First review the actual starting pose. Check facing, scale, support and momentum. A running start changes how a fall develops.

Then review the ending pose. Check the silhouette, contact surface, character proportions and props. If the ending looks unnatural, resolve it before asking for a complete sequence. Request a few distinct alternatives when the pose itself is uncertain.

State which result to preserve:

> Use the extended-prone ending. Keep his head to the right, legs low in the snow and the fallen staff. Match the original model's proportions.

Once those poses work, ask for the middle. Each interim should explain a physical event. For the Maestro fall, useful moments were support loss, clear flight and face-first descent. The count was five total because the request called for three interims between two endpoints.

```text
Start                         End
```

```text
Start          Middle         End
```

```text
Start    Interim    Middle    Interim    End
```

These diagrams describe the order of drawing decisions. They do not prescribe equal timing or a fixed number of drawings.

## Keep each kind of feedback specific

Tell the agent what works and what still needs correction. This keeps a successful pose from being regenerated during a face fix.

| If you see this | Useful instruction |
| --- | --- |
| The action reads incorrectly | "This looks like lying down. Show the loss of support and a body clearly in the air." |
| The endpoint is unnatural | "Explore three natural final silhouettes before adding interims." |
| The pose works but the model drifts | "Keep this pose. Match the approved head, torso and limb proportions." |
| The faces are messy | "The poses are approved. Polish the eyes and face shading without changing the silhouettes or placement." |
| The drawings work but the transition jumps | "Show a short held-pose animatic. Add one drawing between these two poses if it needs one." |
| The motion feels slow or floaty | "Try shorter holds through the fall and keep the landing hold. Preserve the drawings." |

The agent records what you approved separately. "Poses approved" does not automatically approve facial polish, timing or every later tween.

## Review the short motion graphic

Ask to see the current drawings in motion before adding many more:

> Export a brief held-pose animatic from Figma. Repeat the fall twice so I can see which gaps need tweening.

The first motion test should expose the drawing gaps. Crossfades and automatic smoothing can obscure them. A deliberate choppy cadence is compatible with clear anatomy and a consistent face.

Identify the two poses around a weak moment. The agent can then draw the missing transition and preserve the accepted neighbors. If the drawings explain the action but feel mistimed, change their holds before redrawing them.

Review identity as well as motion. Watch the eyes, head shape, limb attachments, prop scale and ground contact. A turning head needs a coherent perspective change. Random shading changes can look like distortion.

## Approve the finished drawing pass

Before locking new drawings, ask:

> Is this the work of a mid-res 8-bit pixel artist?

The agent checks the native drawings, an integer enlargement and the actual exported motion. A crisp grid alone does not answer the question. The character must retain readable features and deliberate pixel clusters throughout the action.

For a small correction, the agent can compare every pixel outside the permitted region. That proves the approved parts stayed fixed. Visual review still decides whether the correction looks good.

Keep the current result on the Figma page. Request a clean MP4 or PNG for sharing. The agent replaces rejected studies, checks references before retiring shared sources and retains the compact current handoff.

The Maestro study demonstrates this process through a review animatic. It does not yet establish a final tween count, final song timing or runtime readiness.
