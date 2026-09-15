# 03: Parent voice — emotion first, mechanically checked rules

**What to build:** Every drop gets a short **reply**. When the input carries emotion, the reply's first sentence is
an emotion reply — not information, a conclusion, advice, or a question. The mechanically checkable rules are
enforced in **code** rather than trusted to the model: a failed check triggers **one regeneration**, and a second
failure **degrades to one safe minimal reply** (an emotion reply or a record confirmation, depending on whether the
input carries emotion), guaranteeing no violating text ever reaches the user.

**Blocked by:** 02 (The shape of catching — auto-splitting items and records)

**Status:** ready-for-agent

- [ ] For an emotional drop, the **reply**'s first sentence is an emotion reply (naming the feeling for the user), not information, a conclusion, advice, or a question.
- [ ] A drop without emotion does not force an emotion reply.
- [ ] Code checks these mechanical rules: at most 3 sentences and roughly 60 characters; does not open by asking "why"; at most one question per turn; no banned-word list; no pet names; no "but / though / at least" contrast ending.
- [ ] A failed check regenerates exactly once; a second failure emits the **safe degraded reply**, which itself passes every mechanical check.
- [ ] The fake provider offers a "deliberately violates the reply rules" script, and a test walks the whole "check → regenerate once → degrade" path with it.
- [ ] Replies are always in Chinese.
- [ ] The judgement-based rules (emotion first, whether it is giving advice, whether it labels the user, whether it decides for the user, whether it issues unsolicited reminders, whether it deflects to "happy things") are enforced by instructions to the AI provider and asserted as **behavioural properties** in tests.
- [ ] When the user says "I don't want to talk about it / never mind / it's fine", it stops probing and leaves only a minimal statement of presence.
- [ ] Advice is given only when the user explicitly asks "what should I do" or has already named a direction, and at most one piece.
