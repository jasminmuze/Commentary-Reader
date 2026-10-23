---
name: Destructive maintenance verification
description: Preserve cleanup safeguards when development and production datasets differ.
---

Do not weaken protected-account checks or create permanent placeholder accounts merely to make a destructive-maintenance test pass. Use fixtures inside an always-rolled-back transaction instead.

**Why:** A protected account existed in production but not in development during cleanup preparation. Treating that difference as a reason to loosen the scope would undermine the protection that matters in production.

**How to apply:** Keep execution disabled until the user's final approval. Verify retained private content, replies, and room access with rollback-only fixtures; an absent protected account must block the real operation.
