# Seed timetables (public facts; safe for the public repo)

| File | Festival | Source | Verified |
|---|---|---|---|
| iii-points-2026.csv | III Points 2026, Mana Wynwood, Miami. Fri Oct 16 (112 sets) and Sat Oct 17 (119 sets), 13 stages | Rendered DOM of https://www.iiipoints.com/set-times/ (`ol.tt-col[aria-label]` → `li.tt-set`), read 2026-10-12 | Extracted directly from the rendered page. An earlier hand transcription was wrong on most Friday stages and is not used. |
| acl-2026-w1-fri.csv | Austin City Limits 2026 Weekend 1, Friday Oct 2, Zilker Park | Official C3 schedule image `ACL26-Schedule-Wk1-Fri_v10.02-B.webp` linked from https://www.aclfestival.com/schedule | Read from the image and checked against a second independent transcription, which differed only on "The 4411". The fan-made Clashfinder grid differs and is not used. |

Notes
- `programme_day` is the festival day a set belongs to; sets after midnight carry the next calendar date in `start_local`/`end_local`.
- III Points prints "LIVE"/"HYBRID" badges glued to some names; `act` has them stripped and `format_badge` keeps them.
- b2b sets (`b2b=yes`) are two artists sharing one slot. Never merge them into one Qloo identity; treat as unknown and fixed by default.
- ACL headliners (Skrillex, Charli XCX) have no printed end time; 22:00 is the grid edge and the park's curfew. Both stay locked.
- ACL's Silent Disco and the Austin Kiddie Limits stage are excluded from scoring.
- Holds on a published timetable are inferred, not contractual. For the seeds, lock day, headliners, stage tier and billing band (opener / middle / sub-headline / headline), not exact position, and label it "Inferred holds, loosened to bands for this scenario".
