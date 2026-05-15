"""Regression: every object node in our output schemas must declare
`additionalProperties: false`.

OpenAI's strict-schema response_format mode rejects schemas that omit this,
which is what `codex --output-schema` enforces under the hood. Without this
guarantee, real Codex calls fail with `invalid_json_schema` before we ever
see model output.
"""

import json
from pathlib import Path

SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"


def _walk_objects(node, path):
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield path, node
        for k, v in node.items():
            yield from _walk_objects(v, path + [k])
    elif isinstance(node, list):
        for i, item in enumerate(node):
            yield from _walk_objects(item, path + [str(i)])


def test_every_object_node_has_additional_properties_false():
    offenders: list[str] = []
    for schema_file in SCHEMAS_DIR.glob("*.schema.json"):
        data = json.loads(schema_file.read_text(encoding="utf-8"))
        for path, obj in _walk_objects(data, []):
            if obj.get("additionalProperties") is not False:
                offenders.append(
                    f"{schema_file.name}: object at /{'/'.join(path) or '<root>'} "
                    f"is missing 'additionalProperties: false'"
                )
    assert not offenders, "\n".join(offenders)


def test_every_property_is_in_required():
    """OpenAI strict-schema rejects schemas where `properties` contains keys
    that are not also listed in `required`. Confirmed empirically against
    Codex v0.130 — optional fields trigger `invalid_json_schema`.
    """
    offenders: list[str] = []
    for schema_file in SCHEMAS_DIR.glob("*.schema.json"):
        data = json.loads(schema_file.read_text(encoding="utf-8"))
        for path, obj in _walk_objects(data, []):
            props = set(obj.get("properties", {}).keys())
            if not props:
                continue
            required = set(obj.get("required", []))
            missing = props - required
            if missing:
                offenders.append(
                    f"{schema_file.name}: /{'/'.join(path) or '<root>'} "
                    f"has properties not in required: {sorted(missing)}"
                )
    assert not offenders, "\n".join(offenders)


def test_all_schemas_parse():
    for schema_file in SCHEMAS_DIR.glob("*.schema.json"):
        json.loads(schema_file.read_text(encoding="utf-8"))
