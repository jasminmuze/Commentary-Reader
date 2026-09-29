---
name: Public email delivery
description: Resend sandbox sender limitation observed during account deletion launch checks
---

Do not assume that a successful signup means email verification or password reset can reach arbitrary users. The sandbox sender rejects mail to recipients other than the connected account's verified address.

**Why:** A disposable-account signup succeeded, but the verification send returned a recipient-restriction error. Public launch needs a verified sending domain and matching sender address; there is no safe code-only workaround for the sender's provider policy.

**How to apply:** Before public release, confirm the operator's verified sender domain and test delivery to a non-owner recipient using a supported sender. Never send real user addresses to an unverified test sender.