# Fabrication review for Darren

The current files passed solid, STL, source-identity and nominal motion checks. They are first-article proposals, not a completed manufacturing specification. Resin printing is the operator's current expectation; the printer and exact resin are not yet confirmed. Hot glue is the operator's accepted bar-to-ball joining approach. Heat shrink is the planned cable protection.

## Close these items before committing to the full print

| Item | Actual gap | How to close it |
| --- | --- | --- |
| Standard hardware | Six fastener sets have nominal envelopes but no complete thread/head/nut/length selection. | Select actual products, match all receiving features, check assembly access and engagement, then re-export. |
| Arcade button installation | The 100 mm recess, 28 mm stem opening and 17.5 mm recess depth are proposed. The matching nut is available, but its installation and thread engagement have not been checked. | Measure the real button, nut, switch/LED modules and attached terminals; check assembly and removal in the tilted box. The verified 63.5 mm reserve is an empty corridor, not a real harness fit. |
| Spinner installation | The 34 mm across-flats x 5 mm stock-hex well and 29 mm body passage are proposals. The 9 mm spacing is not based on measured installed knob height. | Measure the stock hex, body/mount stack and knob height, then check the keeper seat, clamp engagement and support stack using the selected pad/buffer thickness. No extra spinner nut is assumed. |
| Original bar in resin | The unchanged original encloses a sealed internal cavity. | Darren must approve a drain/vent, washing, drying, internal curing and support plan. A drained derivative would be a geometry change, not the unchanged original. [Formlabs hollowing guidance](https://formlabs.com/support/Hollowing-models-in-PreForm/) explains the need for drainage. The collar bar has no separate sealed inner boundary in its exported mesh, but still needs slicer review. |
| Resin process and printer | No build-volume, orientation, support-removal, wash/cure or tolerance plan has been selected. The arcade shell bounds are approximately 116 x 126 x 88.1 mm. | Darren must confirm build fit and process. Use an engineering/tough resin compatible with the actual printer. Check small mating coupons after full post-cure before spending resin on full shells/bars. |
| Small latch features | One collar/lip radial clearance is only about 0.084 mm. The pin shaft is 1.6 mm diameter; its lug is 0.6 mm thick, the cap has about 0.25 mm remaining under the slot, and the pin-retaining bridge is 0.5 mm thick. The closed control-to-roof gap is 0.4 mm. | Qualify clearance, cleaning and strength for the selected process. These values are not validated manufacturing tolerances. Review the pin and retaining bridge for enlargement or metal fabrication. |
| Tool manufacture and operation | The fork has 0.25 mm-thick tines. The spanner has approximately 100 mm-long, 2 mm-diameter pins. No resin process has qualified them as working tools. | Prefer metal working ends unless physical tests establish another process. Verify the actual tools with the glued-in ball and closed box. Hold the ball/bar assembly; bare-bar exterior access is unavailable. The 140 mm lift covers reference tools; the ordinary Wera driver needs more straight-entry space. |
| Buffer, pads and ballast | Material envelopes exist; total pad thickness, buffer location/retention and final ballast containment/mass are unverified. | Measure the actual materials, retain the buffer, and check the captive ballast assembly. Neither adhesive-backed stock nor dense weights establish fit or stability by themselves. |
| Cable exit and anchorage | Channels exist, but no cable clamp, tie-down, gland or compression feature is modeled. | Check the actual heat-shrink-covered bundle, connector passage and bend. Add or select a mechanical anchor at the box exit; heat shrink by itself does not anchor the cable to the box. |

The button box is substantially simpler than the collar. A small fit coupon for each hardware/component interface and one unloaded latch first article can resolve many of these questions without first printing the complete set.

## Validate on the first physical assembly before loaded use

- Seat and tighten every real nut and screw, check adequate thread engagement, and remove/reinstall the bottoms without damaging the resin.
- Check button motion, nut-tool access, attached switch/LED terminals, wires and cable bends with the cover closed.
- Turn the spinner through a full revolution without rubbing, binding, cable interference or unintended encoder loading.
- Run the complete latch attachment/release path with the actual tools, from underneath, while the bar is glued into the ball. Check positive capture, pin retention, re-locking and tool deflection. Internal bar withdrawal currently has 1 mm samples, not a continuous proof for every internal part; fixed-base withdrawal has a separate continuous check.
- Test pad adhesion, grip/preload, slip and the separate low-drag buffer. The modeled 0.2 mm shoe displacement is not a specified clamping force.
- Use the actual ball mass and lever arm to establish support, pull-off, torque, hot-glue bond and stability tests. Neither load capacity nor fatigue life has been established. The load should reach the box through the support stack rather than being assumed safe for the encoder.
- Check cable anchorage and ballast retention, then test tipping and sliding with the intended operating forces.

## Exact material candidates

These are recommended prototype purchases for evaluation, not qualified assembly substitutions. Supplier page facts were checked on October 29, 2026. International delivery and the actual finished thickness still need confirmation.

| Purpose | Exact product and selection | Use and remaining check |
| --- | --- | --- |
| Buffer | [Beeplastic PTFE sheet](https://www.beeplastic.com/products/3mm-ptfe-teflon-sheet-sealing-cut-to-size), **100 x 100 mm / 1 mm / 1 piece** | My first prototype choice for the low-drag ring. The page title says 3 mm; select 1 mm explicitly. Cut 86 mm ID / 91 mm OD. Check ring retention, drag and wear; do not add unbudgeted adhesive thickness. |
| Grip pads | [Rubber & Sponge RS210 closed-cell neoprene, MPN 210-2-40-10-2](https://rubberandsponge.co.uk/product/2mm-thick-x-40mm-wide-adhesive-neoprene-sponge-strip/), **2 mm x 40 mm PSA strip** | Cut two 16 x 8 mm pads, adhesive to the rigid shoe and rubber to the knob. The stock coil is 10 m; ask for an offcut if available. Canadian delivery requires a quote. Measure total thickness including adhesive, compression and bond to the fully cured resin. |
| Compact ballast | [Pinewood Pro 021244 tungsten cubes, 2 oz set](https://www.pinewoodpro.com/tungsten-cube-weights.html) | My compact prototype choice if sand adds too little weight. Each cube is 6.35 mm and about 4.8 g. Nominally below the 7 mm analysis-height reserve, leaving only 0.65 mm for other allowance. Containment and useful target mass are not established. |
| Budget ballast | [QUIKRETE play sand](https://www.homedepot.ca/product/quikrete-play-sand-20kg/1000179897) | Darren's inexpensive approach is reasonable for a prototype if a small dry quantity is available. Use a sealed, fitted pouch, not loose sand. The small pockets limit available mass; test stability rather than assuming they are enough. |
| Cable protection | [Gardner Bender HST-ASTB heat-shrink assortment](https://canada.newark.com/gardner-bender/hst-astb/heat-shrink-tubing-assortment/dp/60AC4624) | Exact off-the-shelf kit, or reuse your existing tubing. Select the diameter for the actual wire/connector and check the recovered bundle through the exit. It does not replace the mechanical anchor. |
| Bar-to-ball bond | [Gorilla Hot Glue Sticks](https://gorillatough.com/product/gorilla-hot-glue-sticks) | Use Darren's accepted hot-glue method. Match mini/full stick diameter to the gun, and test the actual cured print and shell. The manufacturer excludes PE/PP; shell material is unknown, so the bond remains unqualified. |
| Resin on a compatible open-material printer | [Siraya Tech Blu Tough, Clear V2](https://siraya.tech/products/blu-tough-resin-by-siraya) | My tough engineering-resin candidate for the shells, cup, carrier and collar. Darren must confirm the exact printer/profile and follow the [manufacturer's processing guide](https://siraya.tech/pages/blu-user-guide). This is not qualification of the tiny pin or tools. |
| Resin on a compatible Formlabs printer | [Formlabs Tough 2000 Resin V2](https://formlabs.com/products/tough-2000-resin/) | An alternative for the printer family supported by that resin. Do not order it merely because the process is described as resin printing. Manufacturer processing and post-cure conditions matter. |

Use the separate [shopping guide](STL_SHOPPING.md) for the six fastener-set quantities and tool dimensions. Exact fitting fastener products remain an unresolved CAD-design task, not a measurement the operator needs to invent.
