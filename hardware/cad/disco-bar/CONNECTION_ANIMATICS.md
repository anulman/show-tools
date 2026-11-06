# Connection animatics

The B and C movies begin with the complete padded cup already gripping the installed knob. The box and stock hex are fixed. The bar is already glued inside the ball, whose shell is omitted for visibility. C is the operator's selected direction for the next iteration; B remains a comparison.

C turns its separate collar while the cup stays aligned with the ball. B turns the cup and knob relative to the held ball. Both movies show connecting, tightening, unrestricted assembled rotation with the tools removed, unlocking and lifting the ball away. Inserted tools temporarily constrain rotation through the underside ports. The movies do not instruct the operator to fasten any hidden part before gluing the bar.

The local primary movie is `/private/tmp/post-glue-C-animatic-r1/c-connect-and-release.mp4`. Its B comparison is `/private/tmp/post-glue-B-animatic-r1/b-connect-and-release.mp4`. Each output folder also contains a GIF, contact sheet, poster, rendered frames, source/input/output hashes and `verification.json`.

Generate with the isolated CAD Python:

```sh
python hardware/cad/disco-bar/animate_post_glue.py \
  --selector /absolute/path/to/verified/selector.json \
  --concept C --output /absolute/path/to/fresh-output
python hardware/cad/disco-bar/check_connection_animatic.py /absolute/path/to/fresh-output
```

Use `--concept B` for the comparison. The renderer admits the frozen publication first, applies only rigid transforms to its actual STL geometry, and compares its 72 B / 88 C endpoint component poses with the independently exported stages. Maximum permitted vertex deviation is 0.001 mm; observed maxima are below 0.000004 mm. The checker verifies motion order, complete key withdrawal before whole-assembly indexing, M4 pitch/stroke, source/artifact hashes and the actual H.264 stream. Its negative control rejects whole-assembly indexing with a key inserted. The concat encoding repeats the final still, adding two seconds to the planned 36.5-second sequence; the checker accounts for that ending hold.

Box, bar and cup cutaways are viewing aids. The nominal knob/barrel/hex envelopes, rotation marker and ordinary hex keys are illustrative meshes, not newly measured OEM CAD. The video is an operating explanation, not a physical simulation or additional strength/fit approval. It uses the already checked compact base; the C-specific box's access labels do not change that mechanical interface.
