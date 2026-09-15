# 09: Deletion — announce first, then cascade

**What to build:** When deleting a **drop**, the system first states plainly "N **conclusions** came from it", and
the user decides whether to delete those too or only the original text; once confirmed the deletion runs, and after
it the text appears in no **recall** result and no **conclusion** — "deleted" means actually deleted, with no orphan
rows left behind.

**Blocked by:** 05 (Threshold assembly — the first conclusion, portrait and conclusion chain), 07 (Recall — asking about an old thing, answered with its source)

**Status:** ready-for-agent

- [ ] Before deletion it returns a preview: the number of **conclusions** affected by this drop (say "N conclusions came from it").
- [ ] No deletion ever happens before the user makes one explicit choice; there is no silent or default deletion.
- [ ] Choosing "delete those too" cascade-deletes the affected **conclusions** with no orphan rows.
- [ ] Choosing "delete only the original text" removes the drop and record while keeping or invalidating the derived conclusions per a stated rule (pick one at implementation time and write down why); it neither crashes nor leaves dangling references.
- [ ] After a cascade delete, **recall** no longer returns any of that drop's content.
- [ ] After a cascade delete, neither the **portrait** nor the **conclusion chain** retains a trace of it.
- [ ] After a cascade delete, the **terms** and **links** pointing at it are removed too, leaving no orphan rows.
