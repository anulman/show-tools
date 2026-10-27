# Build the Mac I-PAC bench guide

The six-page [PDF](../../../output/pdf/ipac-mac-keyboard.pdf) starts with one unlit switch and the Mac's keyboard facilities. [guide.md](guide.md) is the editable content. [render.py](render.py) draws the original diagrams and produces the PDF without a browser or device access.

## Reproduce the PDF

On this Mac, use the tested `/usr/bin/python3` interpreter, Python 3.9.6, with the pinned [requirements](requirements.txt). The default `python3` resolved to Python 3.15 and failed to bootstrap pip, so that invocation is not the reproduced setup. On another host, select an interpreter with working `venv` and pip support.

```sh
/usr/bin/python3 -m venv /tmp/ipac-guide-venv
/tmp/ipac-guide-venv/bin/pip install -r docs/guides/ipac-mac/requirements.txt
/tmp/ipac-guide-venv/bin/python docs/guides/ipac-mac/render.py
/tmp/ipac-guide-venv/bin/python docs/guides/ipac-mac/qa.py output/pdf/ipac-mac-keyboard.pdf /tmp/ipac-guide-qa
```

The renderer writes `output/pdf/ipac-mac-keyboard.pdf`. An optional first argument changes its output path. Its fixed metadata makes repeated builds deterministic in the tested environment. Explicit page separators in the Markdown define the six designed pages. The small renderer supports the headings, paragraphs, links, lists, tables, code blocks, callouts, and two diagram directives used here.

The QA command checks the six-page count with two PDF readers, visible text bounds, replacement glyphs, and HTTPS link annotations. It writes a SHA-256 receipt, extracted text, and one 108 dpi PNG per page. Open every PNG after a content or layout change. Automated bounds checks do not prove readable spacing or correct wiring.

If Poppler is installed, compare a second rendering with `pdftoppm -r 108 -png output/pdf/ipac-mac-keyboard.pdf /tmp/ipac-guide-page`. This delivery used PyMuPDF: Poppler was absent, and its Homebrew installation was stopped during downloads when it proposed unrelated dependency upgrades. No Chrome, Sheets, USB enumeration, or hardware commands were run.

## Sources and review boundaries

The [source manifest](sources.md) separates operator inventory from manufacturer specifications and unconfirmed installation details. Links in the PDF are clickable. The primary Addison page returned HTTP 405 during research, so the guide labels it an operator-supplied reference and does not claim verified terminal numbering.

Tom Dale's [inside-mac](https://github.com/tomdale/inside-mac) skills were read at commit `8950d1697e1a0c55ebace8557f2c66596954a8a2`: `imac-task-guides`, `imac-voice-and-tone`, `imac-review`, and `imac-pdf-book`. The guide applies their smallest complete workflow, local failure recovery, explicit acceptance checks, and warnings beside dependent actions. It uses an original ReportLab layout rather than the book template or its Chrome pipeline. No skill was installed globally. The [MIT notice](inside-mac-LICENSE.txt) accompanies this attribution.

The poteto technical-writing and unslop passes kept this a task guide. The Build the Lever principle led to the checked-in renderer and QA command. The PDF review covers layout and source-backed instructions. Actual key mapping, controller mode, cable orientation, LED compatibility, and physical fit remain operator tests.

See [verification.md](verification.md) for the final artifact receipt and page review.
