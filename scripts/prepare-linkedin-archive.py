#!/usr/bin/env python3
"""Prepare a private, lossless offline bundle from explicitly selected account exports.

Usage: python3 scripts/prepare-linkedin-archive.py MANIFEST OUTPUT_DIRECTORY
Manifest: account, ownerProfileUrl, sources [{path, kind, exportedAt, member?, owner?}].
ZIP sources require owner=[first_name,last_name] matching Profile.csv exactly.
No directory-wide guesses, name-based contact joins, or network access.
"""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import zipfile


def prepare(manifest, output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output, 0o700)
    sources = []
    for spec in manifest["sources"]:
        path = Path(spec["path"]).expanduser().resolve()
        if spec.get("member"):
            with zipfile.ZipFile(path) as archive:
                profiles = [n for n in archive.namelist() if Path(n).name == "Profile.csv"]
                if len(profiles) != 1 or not spec.get("owner"):
                    raise ValueError("ZIP source requires one Profile.csv and explicit owner")
                profile = next(csv.DictReader(io.StringIO(archive.read(profiles[0]).decode("utf-8-sig"))))
                if [profile.get("First Name"), profile.get("Last Name")] != spec["owner"]:
                    raise ValueError(f"Archive owner mismatch: {path}")
                members = [n for n in archive.namelist() if Path(n).name == spec["member"]]
                if len(members) != 1:
                    raise ValueError(f"Expected one member: {spec['member']}")
                raw = archive.read(members[0])
            original = f"{path}!/{members[0]}"
        else:
            raw, original = path.read_bytes(), str(path)
        digest = hashlib.sha256(raw).hexdigest()
        raw_path = output / f"{digest}.csv"
        if raw_path.exists():
            if raw_path.read_bytes() != raw:
                raise ValueError("Existing source hash mismatch")
        else:
            with raw_path.open("xb") as handle:
                os.chmod(raw_path, 0o600)
                handle.write(raw)
        table = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline="")))
        start = next(i for i, row in enumerate(table) if row and row[0] == {
            "connections": "First Name", "rich-connections": "id",
            "messages": "CONVERSATION ID", "invitations": "From",
        }[spec["kind"]])
        counts, headers = {}, []
        for column in table[start]:
            counts[column] = counts.get(column, 0) + 1
            headers.append(column if counts[column] == 1 else f"{column}#{counts[column]}")
        rows = []
        for row in table[start + 1:]:
            if not row or not any(row):
                continue
            if len(row) != len(headers):
                raise ValueError(f"CSV width mismatch: {original}")
            rows.append(dict(zip(headers, row)))
        sources.append(dict(id=digest, kind=spec["kind"], exportedAt=spec["exportedAt"],
                            dateBasis=spec.get("dateBasis", "explicit export snapshot date"),
                            originalPath=original, rawPath=str(raw_path), rows=rows))
    result = dict(version=1, account=manifest["account"], ownerProfileUrl=manifest["ownerProfileUrl"], sources=sources)
    bundle = output / "bundle.json"
    if bundle.exists() and json.loads(bundle.read_text()) != result:
        raise ValueError("Use a new output directory for different source selection")
    with bundle.open("w") as handle:
        os.chmod(bundle, 0o600)
        json.dump(result, handle, ensure_ascii=False)
        handle.write("\n")
    print(json.dumps(dict(bundle=str(bundle), sources=len(sources), rows={s["kind"]: sum(len(x["rows"]) for x in sources if x["kind"] == s["kind"]) for s in sources})))


if __name__ == "__main__":
    prepare(json.loads(Path(sys.argv[1]).read_text()), sys.argv[2])
