"""Optional independent HTTPS intelligence lookup with per-IP cache and budget."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import quote

from .classifier import classify
from .common import ServiceError, ToolError, digest, expires_at, get_json, https_url, is_fresh, write_json


def enrich(nodes: list, settings: dict, cache_path: Path, transport=get_json):
    template = os.getenv("INTELLIGENCE_URL_TEMPLATE", "")
    if not template:
        return {"enabled": False, "queries": 0, "service_errors": []}
    if "{ip}" not in template:
        raise ToolError("intelligence_ip_placeholder_required")
    https_url(template.replace("{ip}", "1.1.1.1"))
    try:
        cache = json.loads(cache_path.read_text())
    except (FileNotFoundError, ValueError):
        cache = {}
    stats = {"enabled": True, "queries": 0, "service_errors": []}
    headers = {"X-API-Key": os.environ["INTELLIGENCE_TOKEN"]} if os.getenv("INTELLIGENCE_TOKEN") else {}
    provider = "independent_https_" + digest(template.encode())[:12]
    unavailable = False
    for node in nodes:
        protocol = node["protocols"]["sstp"]
        if protocol["status"] != "passed":
            continue
        ip = protocol["expected_exit_ip"]
        key = provider + ":" + ip
        entry = cache.get(key, {})
        try:
            if is_fresh(entry.get("expires_at")):
                raw = entry["raw"]
            elif not unavailable and stats["queries"] < settings["intelligence_query_limit"]:
                stats["queries"] += 1
                raw = transport(template.replace("{ip}", quote(ip)), timeout=settings["node_timeout_seconds"], headers=headers)
            else:
                protocol["intelligence_error"] = "intelligence_budget_or_service_unavailable"
                continue
            image = classify(raw, settings, provider, ip)
            image["identity_assurance"] = "normal_https_certificate_validation"
            if is_fresh(entry.get("expires_at")):
                image["queried_at"] = entry.get("queried_at")
                image["cache_used"] = True
            protocol["egress"] = image
            if not is_fresh(entry.get("expires_at")):
                cache[key] = {"raw": raw, "queried_at": image["queried_at"],
                              "expires_at": expires_at(settings["intelligence_ttl_seconds"])}
        except (ServiceError, ToolError) as exc:
            protocol["intelligence_error"] = str(exc)
            stats["service_errors"].append(str(exc))
            # Do not hammer the provider after 429 or an outage; keep prior evidence labelled.
            unavailable = True
    write_json(cache_path, cache, private=True)
    return stats
