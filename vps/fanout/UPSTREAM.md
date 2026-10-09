# fanout upstream notice

This directory is based on `byJoey/fanout` commit `d7ce5224caf3469b19876982abdf8d1be16c4a8b`.

The upstream project is MIT licensed. Its original `LICENSE` is retained in this directory.
The changes in this fork are limited to the xnvgatebox integration:

- load candidates from the shared validated node pool instead of fetching a second VPN Gate pool;
- keep Exit Slot ports on an explicit fixed mapping and bind SOCKS listeners to loopback;
- perform two-endpoint HTTPS expected/actual exit checks;
- add a host and namespace kill-switch so a dead OpenVPN cannot use the host NAT as a fallback.

The upstream source remains identifiable so license obligations and future diff review are clear.
