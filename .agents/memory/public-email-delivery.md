---
name: Public email delivery
description: Resend sandbox sender limits and account/domain alignment
---

Do not assume that a successful signup means email verification or password reset can reach arbitrary users. A connected Resend account may be test-restricted, and a domain verified in a different Resend account does not remove that restriction. The sending key and verified domain must belong to the same account.

**Why:** A signup succeeded, but the connected sender returned a recipient-restriction error despite the operator verifying a domain elsewhere. Public delivery depends on provider account identity and permissions, not only the `from` address.

**How to apply:** Before public release, confirm the verified domain and sending key are from the same Resend account, configure the exact sender address, then test delivery to a non-owner recipient. Never send real user addresses through a test-restricted sender.