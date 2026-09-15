# 02: The shape of catching — auto-splitting items and records

**What to build:** Drop a messy input (say "the teacher explained how the final is graded today, outline due next
Wednesday") and the system splits it into an **item** and a **record**, showing on the page what this drop caught.
The user never picks a type, fills in a time, or tags anything. An item with no parsed time is kept as
"unscheduled" rather than discarded. The **input type** (emotion/decision/item/inspiration) is marked internally
but never shown and never asked for.

**Blocked by:** 01 (Project skeleton and the first "drop" end to end)

**Status:** ready-for-agent

- [ ] One drop can produce both an **item** and a **record**, and the **record** is the original text, not a summary.
- [ ] The **item** points back to the drop it came from.
- [ ] An item with no parsed time is kept as "unscheduled" and appears in no time slot.
- [ ] The system marks the drop with an **input type** internally, while the page offers no type selector and displays no classification.
- [ ] Extraction failure or delay does not affect the drop's success (reusing 01's asynchronous shape), and extraction can be re-run later.
- [ ] The items produced by a drop are visible on the page.
