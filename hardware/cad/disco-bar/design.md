# Coupling a disco ball to the SpinTrak knob

A printed internal bar glued to the shell is a plausible prototype for transmitting rotation. Its value is a small part count and an interface shaped around the existing knob. A snug fit alone does not establish dependable grip, shell attachment, or a safe weight path.

The following comparison is engineering judgment about proposed designs. None has been built or load-tested in this workstream.

| Approach | Benefit | Unresolved constraint |
| --- | --- | --- |
| Hot-glued bar with a friction socket | Few parts; leaves the current knob in place | Grip depends on contact pressure and actual surface contact. Glue attachment and shell deformation need tests. Removal may damage the shell or its finish. |
| Bar with an adjustable split collar around the knob | Grip can be adjusted after printing; the knob connection can be released | Requires fastener access and enough knurled height. Clamp force must not damage the knob, collar, or shell. The shell attachment still needs a solution. |
| Independent rotating ball support with a separate torque coupler | Provides a distinct path for weight and hand loads while the encoder senses rotation | Requires space, alignment, support hardware, and an accessible coupler. This is a larger assembly that needs its own measurements. |

For a friction contact, `τ ≈ μ N r` is an analytical model of available torque: friction coefficient times total normal load times effective contact radius. The actual contact is knurled and may deform or interlock, so the model is only a starting point. Neither μ nor N is measured. No torque capacity, interference allowance, or clamp setting is selected.

A broader socket contact and wider shell pads are candidates for distributing forces. They need accessible assembly surfaces and must fit through the real opening. A removable collar gives a way to tune grip without repeatedly gluing the ball. Neither change by itself gives the ball independent support.

The [SpinTrak manufacturer page](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/) describes two sealed bearing races and optional flyweights. The inspected page supplies no axial, radial, or bending load rating for a custom ball assembly. Those descriptions do not establish acceptable ball or hand loads. The [accessories page](https://www.ultimarc.com/trackballs-and-spinners/spinner-accessories/) lists different knob models, so a catalogue diameter cannot identify the installed part.

No adhesive specification applies yet. The shell material, print material, glue product, contact preparation, and operating temperature are unknown. Claims about bond strength, temperature resistance, or removability require those facts and a physical coupon test.

The parent session is collecting the facts needed for a fitted model:

- What does Darren's cylindrical reference represent, and does its opening expose the proposed glue surfaces?
- What are the measured maximum knurled diameter, usable contact height, and any shoulders or protrusions on the installed knob?
- What are the ball's dimensions, mass, shell material, and thickness at the intended attachment points?
- What supports the ball now, how will the operator turn it, and must the ball lift off for transport or service?
- Which print material and adhesive are intended, and is fastener access available inside the shell?

After those answers, the next CAD milestone can compare an explicitly dimensioned socket coupon with an adjustable collar. A trial assembly must establish grip under reversal, attachment integrity, free rotation, and the ball's support path. CAD validity alone cannot verify those properties.
