---
name: Account deletion and shared rooms
description: Why a person's deletion cannot remove shared reading-room content or depend on finding a successor
---

Account deletion must remain available even when the person is the only current member of a room. Preserve posts and highlights written by other users; if no one can receive ownership, an unowned archive is safer than deleting their work. Do not restore private-room access to someone who had left or been removed merely because they once posted there.

**Why:** A former member's content can outlive their room membership. Requiring another member to accept ownership would also make self-service account deletion impossible for a sole owner.

**How to apply:** Any change to room membership, private-room access, or deletion policy should check both the authorship of retained content and whether the viewer currently has permission to see it.

Private-room share links are bearer invitations: anyone holding the link may join, and the owner can revoke the active link. Switching a room to public invalidates its existing private share link.

**Why:** The user explicitly chose link-based access for private rooms and accepted that recipients can forward the link.

**How to apply:** Treat possession of the signed link as authorization; verify the active server-side link before adding membership, and do not restrict link recipients to friends or pre-approved accounts.