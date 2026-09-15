# 08: Scheduling — items landing on time

**What to build:** **Items** land on time automatically, with no time typed by the user. The page shows the list of
items coming due, so opening the page tells the user what to do; items with no parsed time stay "unscheduled"
rather than being dropped.

**Blocked by:** 02 (The shape of catching — auto-splitting items and records)

**Status:** ready-for-agent

- [ ] An item carrying time information lands on a concrete time automatically, with no manual entry.
- [ ] An item with no parsed time is kept as "unscheduled" and never silently discarded.
- [ ] The page lists items coming due by time, plus a separate unscheduled list.
- [ ] An item's state can be advanced (say from todo to done) and that state survives a refresh.
- [ ] Scheduling introduces no full calendar UI and does no conflict detection.
- [ ] The demo stage makes no system-level push or reminder-reliability guarantee.
