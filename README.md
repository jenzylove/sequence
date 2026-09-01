# sequence (technical spike)

Proving ONE path, not building the product:

real DreamDEX resolution on Shannon (OracleHub `AnswerDelivered`)
  -> Somnia Reactivity invokes our Solidity handler
  -> handler deterministically prepares/triggers one bounded successor DreamDEX action.

## Scope honesty
- Mechanics are proven deterministically against a controlled emitter we own that
  re-emits the EXACT verified `AnswerDelivered` signature (test/ + a local emitter).
- A live subscription script points at the REAL OracleHub + a real marketId so a
  genuine window resolution can be observed invoking the handler.
- These two are labelled separately. The controlled harness is NOT the live proof.

NOT in this spike: frontend, the full strategy engine, multi-step sequences.

See docs/VERIFIED.md for interface provenance.
