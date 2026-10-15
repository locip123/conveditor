import json
from pathlib import Path


class Artifacts:
    """Local single-user artifacts; IDs are validated by the API contracts."""

    def __init__(self, root: Path):
        self.root = root

    def save(self, identifier: str, image: bytes, record: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / f"{identifier}.png").write_bytes(image)
        (self.root / f"{identifier}.json").write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")

    def load(self, identifier: str) -> tuple[bytes, dict]:
        record = json.loads((self.root / f"{identifier}.json").read_text(encoding="utf-8"))
        return (self.root / f"{identifier}.png").read_bytes(), record
