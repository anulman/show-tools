# Hand off verified work without reconstructing evidence

Use the existing build manifests, check output, and terminal staging evidence to report a candidate. This guide adds no receipt schema, service, deployment authority, or operator approval gate. The [deterministic command contract](deterministic-pipelines.md) still owns failure handling.

## Identify the candidate and its evidence

Keep these identities separate in the handoff.

- The source revision identifies the checkout used to build the candidate. A later documentation commit does not rename a frozen artifact.
- Component provenance identifies native and peripheral inputs. Their revisions can differ from the application revision when the release builder verifies source equivalence.
- Artifact paths and SHA256 values identify the actual release, archive, and check outputs. Use `release.json`, `SHA256SUMS`, and `provenance/source.json` from the release rather than reconstructing their values from conversation.

For each relevant check, report its command, exact inputs, verdict, evidence path and hash, and limitations. Verify that the referenced file exists and still matches its hash before handing it off. Reuse a result only for the inputs it checked. If those inputs are uncertain, rerun the affected check.

Name any unresolved operation, its cause, its next step, and its owner. Distinguish missing evidence from a failed product check. Missing or stale harness evidence needs Chief recovery. A failed product invariant remains blocked until the product satisfies it. Neither case accepts an invalid artifact.

Keep mutable host observations separate from immutable artifact evidence. Record the target, observation time, and any expiry supplied by the governing request or grant. Idle state, active performance, installed capability recognition, device ownership, and current service state must be observed again when the operation requires them. A local source check cannot establish those facts.

## Use the fixed staging caller within recognized scope

`scripts/stage-session-release-admission.py` is the fixed admission caller for the anchored staging path. On its assigned Linux host, its interface is:

```sh
python3 -I scripts/stage-session-release-admission.py \
	--envelope /home/anulman/.local/share/show-tools/staging/ENVELOPE.json \
	--plan /home/anulman/.local/share/show-tools/staging/PLAN.json \
	--archive /home/anulman/.local/share/show-tools/staging/RELEASE.tar.gz \
	--executor /home/anulman/.local/share/show-tools/staging/stage-session-release-anchored.py \
	--validator /home/anulman/.local/share/show-tools/staging/stage-session-release.py
```

All five inputs must be in its fixed app-private staging directory. The caller checks the assigned host and user, protected checker pins, executor and validator hashes, reviewed archive accounting, and pinned current application files. It is a fixed-target caller with frozen preconditions, not a general deployment runner. The matching reviewed files and recognized host capability are prerequisites. This example is an interface reference, not a claim that the caller or grant is installed.

The caller coordinates preflight, inspection, one claim, a running record, fresh prepublication inspection, anchored staging, independent published readback, and terminal reconciliation. It writes evidence under `/home/anulman/.local/share/show-tools/staging/<requestId>-admission/`. A completed JSON outcome returns `resultSha256` and the completed audit receipt. Match those to `result.json` and `completed-receipt.json` in that directory. Preserve an uncertain result for reconciliation rather than claiming again. Local `EXECUTION_APPROVED` records source review state. It does not prove installation or host recognition.

`scripts/stage-session-release.py` remains the archive validator. `scripts/stage-session-release-anchored.py` owns anchored publication. The [installation guide](elitedesk-install.md) describes the wider application installation and acceptance scope. Staging alone does not deploy a profile, restart a service, enable audio, or establish physical acceptance.

## Separate standing consent from installed capability

Standing operator consent covers routine verified application actions on explicitly assigned targets within the recognized scope. Missing host delegation is a named bootstrap dependency. It is not a reason to request the same application consent again.

Source changes and local receipts cannot install or expand a protected grant. The [delegation guide](../../lib/remote-performance/delegation/README.md) describes the operator bootstrap and independent host recognition. Use the actual target assignment, application paths, and named service. Preserve an active performance.

When a new concern blocks work, name the applicable rule, affected operation, concrete failure, and missing evidence. Send unresolved interpretations to Chief and continue independent work. Chief recovery cannot waive a product invariant.
