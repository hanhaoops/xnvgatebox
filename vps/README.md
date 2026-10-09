# VPN Gate Box VPS Multi-Exit v0.2

The manager consumes the shared Pool Builder output through
`FANOUT_VALIDATED_POOL_FILE`; it does not fetch a second independent VPN Gate
list. The namespace, fixed-port, health and SOCKS implementation used the
MIT-licensed `byJoey/fanout` project as an implementation reference. The
upstream commit and license notice are recorded in
[`fanout/UPSTREAM.md`](fanout/UPSTREAM.md); the user-facing product is VPN Gate
Box and its data source is VPN Gate.

The first VPS profile is intentionally one Slot because a small VPS may have
only one vCPU and 1 GB RAM.  `FANOUT_SLOT_PORT_BASE=17928` makes slot 1 use
`127.0.0.1:17928`.  The SOCKS listener is loopback-only.  A Slot is accepted
only after two HTTPS expected probes, two HTTPS SOCKS actual probes, and an
explicit check that the expected IP differs from the VPS public IP.

The systemd template is [`xnvgatebox-fanout.service`](xnvgatebox-fanout.service).
Install the generated pool and profiles under `/var/lib/xnvgatebox/pool/`, copy
the environment template to `/etc/default/xnvgatebox-fanout`, and place the
Linux amd64 binary at `/usr/local/bin/xnvgatebox-fanout`.  Keep the management
server bound to loopback until its authentication and reverse-proxy policy are
reviewed.

The built-in web UI shows the shared **Validated Nodes** pool, current **Exit
Slots**, tunnel health, manual node replacement, 3x-ui bindings and the
protected subscription address. It is served by the same authenticated
management process; it is not a separate public static site.

`FANOUT_RESIDENTIAL_ONLY=0` is used only for the first technical tunnel test
when the shared pool has no IP-intelligence classification.  It does not mark
unknown nodes as residential.  After an intelligence provider is configured,
set it back to `1` and use the shared strict/likely classification.
