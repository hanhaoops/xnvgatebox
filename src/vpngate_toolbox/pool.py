"""The same Pool Builder runs on Actions and on a standalone VPS."""
from __future__ import annotations

from pathlib import Path

from .common import ServiceError, ToolError, atomic_write, digest, get_bytes, utc_now, write_json
from .vpngate import parse_csv


def build_pool(settings: dict, output: Path, csv_file=None, transport=get_bytes) -> dict:
    errors = []
    if csv_file:
        data = Path(csv_file).read_bytes()
        source = "local_csv"
        if len(data) > 12_000_000:
            raise ToolError("csv_too_large")
        nodes, profiles, rejected = parse_csv(data, settings)
    else:
        for source in settings["source_urls"]:
            try:
                data = transport(source, timeout=settings["node_timeout_seconds"])
                nodes, profiles, rejected = parse_csv(data, settings)
                if not nodes:
                    raise ServiceError("empty_source_pool")
                break
            except (ServiceError, ToolError) as exc:
                errors.append(str(exc))
        else:
            raise ServiceError("pool_source_unavailable")
    if not nodes:
        raise ToolError("no_candidates_matching_filters")
    for sha, profile in profiles.items():
        atomic_write(output / "configs" / (sha + ".ovpn"), profile)
    pool = {"schema_version": 1, "generated_at": utc_now(),
            "source": {"name": source, "sha256": digest(data), "rejected_rows": rejected, "errors": errors},
            "nodes": nodes}
    save_pool(pool, output)
    return pool


def save_pool(pool: dict, output: Path):
    write_json(output / "node_pool.json", pool)
    atomic_write(output / "node_pool.json.sha256", (digest((output / "node_pool.json").read_bytes()) + "\n").encode())
