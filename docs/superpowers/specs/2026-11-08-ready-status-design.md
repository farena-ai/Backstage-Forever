# Quiet successful companion setup

The successful setup dock currently repeats above all seven pages after a valid snapshot imports. Remove that dock when setupReady() is true. Retain actionable incomplete setup guidance and the existing explicit setup action on Game Connection. A compact global connection badge is a later visual pass; adding dismissals or a separate success notification now would add unnecessary state.

Acceptance: after a synthetic valid import, all seven pages omit the dock, navigation works, and Game Connection can still reopen setup. Existing missing-snapshot/setup checks must keep passing. This source change does not modify the running installation; bundle it into the next feature release.
