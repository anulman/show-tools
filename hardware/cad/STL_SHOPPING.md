# Buy, cut and reuse parts for the prototype

This list accompanies the fabrication-only STL ZIP. The ZIP contains 15 print-part proposals, including Darren's original bar as an alternative, plus the captive pin, pull fork and long-reach spanner as three custom fabrication proposals. It excludes this guide, the validation manifest, foam/rubber reference shapes and the ordinary screwdriver clearance model. Sizes below describe the present CAD proposal; supplier listings do not prove installed fit.

The operator now expects resin printing and plans heat-shrink cable protection. See the [fabrication review and exact material candidates](FABRICATION_REVIEW.md) for the resin-specific gaps, recommended buffer/grip/ballast products, and first-article checks. Heat shrink still needs a box-side mechanical anchor.

## Use an ordinary screwdriver where it fits

The driver STL was a clearance model, not a requirement to manufacture a screwdriver. A long precision flat-blade screwdriver is the ordinary-tool candidate. [Wera 2035 Micro 05118007001](https://www.wera.de/en/05118007001) has a [manufacturer drawing](https://hybris-media.wera.de/download/pdfgenerator-datasheets/en/05118007001.pdf) specifying a 0.4 x 2.0 mm blade, 100 mm shaft, 2.5 mm shaft diameter, and 197 mm overall length. Its tip and shaft nominally fit the present 0.8 x 2.6 mm slot and 2.8 mm reference shaft envelope. That is a dimensional comparison, not complete tool/access validation.

The full Wera tool is much longer than the checked driver reference. The same straight axial staging route would need approximately 198 mm of free space below the cover before handling margin, rather than the proposed 140 mm lift. Another insertion route has not been checked. [Wiha 26043 PicoFinish, 2.5 mm x 100 mm](https://www.wihatools.com/products/picofinish-precision-slotted-2-5-x-100mm) is another ordinary-tool candidate, but its page does not establish all blade/shaft dimensions. Verify the actual tool and full insertion path. An ordinary 1/4-inch bit holder is wider than the checked shaft.

The fork pulls under the captive pin's head. The current reference has a 0.25 mm-thick tip, approximately 2.6 mm overall width, and about 87 mm of reach. A generic watch spring-bar fork, pick or tweezers has not been verified through the closed box's access path.

The spanner turns the independent collar. Its two 2 mm pins are 72.6 mm apart, with about 100 mm of reach. The bridge stays outside the box. A normal short-pin face spanner matching the hole spacing alone is not a verified replacement. The fork and long spanner remain custom proposals in this prototype; designing around standard tools would require another access/mechanism iteration. Neither custom tool STL is a validated plastic-print specification. A purchased [AMF 50427 adjustable face spanner](https://www.amf.de/en_us/adjustable-face-spanner-set-50427) offers the needed nominal spacing and 2 mm pins, but its manufacturer does not establish the required deep reach; do not buy it as a confirmed replacement. The common [Park Tool SPA-2](https://www.parktool.com/en-us/product/pin-spanner-red-spa-2) opens only to 45 mm, less than the required 72.6 mm, so it does not fit this collar.

## Shopping shortlist

Links were checked on October 29, 2026. Prices, shipping and availability are not guaranteed. Quote-only sources are identified separately from selectable product listings.

| Item and quantity | Product or source | What to choose or confirm |
| --- | --- | --- |
| Grip pads, 2 cut pieces | [Genesis Rubber sheeting and stripping, Canada](https://genesisrubber.ca/products/sheeting-stripping/) | Quote a small piece of 2.0 mm neoprene/EPDM rubber or sponge, pressure-sensitive adhesive on one side and a plain rubber contact face. Confirm total thickness including adhesive. Cut two 16 x 8 mm pads; grip/preload still needs a test. |
| Exact-thickness grip-stock product alternative | [2 mm self-adhesive neoprene sponge](https://rubberandsponge.co.uk/product/2mm-thick-x-2mt-x-1mt-self-adhesive-neoprene-sponge/) | Actual 2 mm product listing, but the full sheet is excessive for two pads. Ask for an offcut/strip and confirm international shipping before ordering. Adhesive faces the printed shoe, never the knob. |
| Low-drag buffer, 1 cut ring | [Canada Plastic & Belting PTFE sheets, Toronto](https://canada-plastics.com/product/ptfe-sheets/) | Quote a 1.0 mm solid PTFE offcut at least 100 x 100 mm. Exact thickness/stock availability needs confirmation. Cut one 86 mm ID / 91 mm OD ring; no adhesive thickness is assumed. |
| Selectable PTFE product alternative | [Beeplastic PTFE sheet](https://www.beeplastic.com/products/3mm-ptfe-teflon-sheet-sealing-cut-to-size) | Despite the 3 mm page title, select the **100 x 100 mm / 1 mm** variant. Confirm shipping to Canada. This is a material candidate, not a load/wear validation. |
| Bar-to-ball hot glue, as needed | [Gorilla Hot Glue Sticks](https://gorillatough.com/product/gorilla-hot-glue-sticks) | Follow Darren's hot-glue approach. Choose the diameter for your gun: the manufacturer lists 0.27-inch mini and 0.43-inch full-size. It supports high/low-temperature guns but excludes PE/PP plastics. With substrates unknown, test the bond before supporting the assembled ball. |
| Contained ballast, optional, 1 load per box | [QUIKRETE play sand, Home Depot Canada](https://www.homedepot.ca/product/quikrete-play-sand-20kg/1000179897) | A source for washed/screened play sand, not a recommendation to buy a large bag for these tiny cavities. Use dry sand in a suitably sized sealed pouch. Filled pouch dimensions and target mass remain unselected. |
| Cover, keeper and collar fasteners | [Spaenaur fastener categories, Canada](https://spaenaur.com/pages/all-categories-en) | Supplier link only. Do not order a nominal M-size inferred from the CAD envelopes. Thread, head, nut standard and length must be selected and checked against the geometry first. |
| Cable protection and strain relief, as required | [Spaenaur grommets, ties and straps](https://spaenaur.com/pages/all-categories-en) | Select against the actual cable and exit dimensions. A grommet protects an edge; it does not by itself establish strain relief. No fitting SKU has been selected. |

The high-grip pads and low-drag buffer have opposite jobs. Do not replace the buffer with the same grippy foam. A 1/16-inch sheet is 1.5875 mm, not a drop-in 2.0 mm pad; 1/32 inch is 0.79375 mm, not a drop-in 1.0 mm buffer.

## Fastener quantities pending size selection

| Joint | Buy quantity |
| --- | --- |
| Arcade bottom | 4 screws and 4 captured nuts |
| Knob-box bottom | 4 screws and 4 captured nuts |
| Stationary stock-hex keeper tabs | 2 screws and 2 nuts |
| Carrier to bar | 3 screws and 3 nuts |
| Pin-retaining bridge | 2 screws and 2 nuts |
| Padded knob grip | 2 set screws and 2 nuts |

These are six separate fastener sets. Do not assume their head shapes, lengths or nut sizes are interchangeable. The keeper nuts are additional small fastener nuts, not another spinner retaining nut. Reuse the spinner's existing stock hex and the arcade button's existing matching mounting nut. Reuse the installed spinner, knob, button, switch/LED modules and harness.

The ballast cavities are proposed as 72 x 24 x 8 mm in the arcade box and 72 x 16 x 8 mm in the knob box. The smaller analysis reserves are 71 x 23 x 7 and 71 x 15 x 7 mm respectively. These are packaging limits, not validated pouch or ballast purchasing specifications.
