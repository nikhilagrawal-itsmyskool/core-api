# Onboarding Rollout — SMS / WhatsApp / Push / Play

Wiring a school's messaging + app. Three branches.

Entities: **Kaizen Force** = our company (owns ItsMySkool); **DBPASN** = the school's own entity.
Shared MSG91 + FCM accounts live under `nikhil.pa@gmail.com`.

---

## Branch 1 — DBPASN (flagship, mostly live)
- **SMS header:** done — own PE (VIL Power, header `DBPASN`, PEID `1101462520000097292`). No new work.
- **WhatsApp:** existing DBPASN number/brand registered. No new work.
- **FCM:** none — DBPASN app is one app in the shared Firebase project.
- **Play:** get **D-U-N-S for DBPASN (the school)** → DBPASN developer account → publish the DBPASN app under it.
  - *Status:* D-U-N-S request submitted, ref **`DR103120263632941400`** (entity *Dr. B.P. Agrawal Shiksha Niketan*, PAN `AAIAD4989L`, Farrukhabad; contact nikhil.pa@gmail.com / 8373919559). No reply yet. Free route ≈ up to 30 business days.
  - *Follow-up:* first check the free lookup (`dnb.com/duns-number/lookup.html`) + email/spam; else email **serviceindia@dnb.com** (cc **serviceindia@helpdesk.dnb.com**) quoting the ref, or call Mumbai HO +91 92288 64839. Only D&B is authorised — avoid third-party "DUNS agents".

## Branch 2 — Generic ItsMySkool (one-time foundation)
- **SMS header:** ask MSG91/DLT — register an **"ItsMySkool" header** (6-char limit → `IMSKUL`/`ITSMYS`) under **Kaizen Force's PE**.
- **WhatsApp:** new mobile number, register via the existing `nikhil.pa@gmail.com` MSG91 account, display brand **"ItsMySkool"**.
- **FCM:** none — shared project.
- **Play:** get **D-U-N-S for Kaizen Force** → Kaizen developer account → publish **ItsMySkool** (and future white-label apps) under it.

## Branch 3 — Another white-labeled school (repeat per school)
- **Upfront:** decide **which school documents to collect** (entity proof / authorization — list TBD).
- **SMS header:** school wanting its **own brand header** needs **its own PE** (own docs, own DLT registration) — we likely can't register a school's header under Kaizen's PE. If the school is fine as generic → reuse the ItsMySkool header, nothing new.
- **WhatsApp:** new mobile number + own WhatsApp registration/brand for the school — or reuse the generic ItsMySkool number.
- **FCM:** none — add the app to the shared project.
- **Play:** publish under **Kaizen's** developer account (white-label), or the school's own if it has its own D-U-N-S.

---

## Confirm externally (blocks the above)
- **DLT / MSG91:** can a header sit under a PE that isn't the brand owner? Expectation: a school's own header needs that school's own PE; Kaizen's PE only holds ItsMySkool/generic headers.
- **Meta / WhatsApp:** will the display name ("ItsMySkool" / a school's name) be approved under the verifying business?
