from pathlib import Path
from uuid import uuid4
import shutil

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
UPLOAD_DIR = DATA_DIR / "uploads"


def ensure_storage():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def save_upload(user_id: int, filename: str, fileobj):
    ensure_storage()
    ext = Path(filename).suffix
    name = f"{uuid4().hex}{ext}"
    user_dir = UPLOAD_DIR / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    dest = user_dir / name
    with dest.open("wb") as f:
        shutil.copyfileobj(fileobj, f)
    size = dest.stat().st_size
    rel_path = dest.relative_to(DATA_DIR).as_posix()
    return rel_path, size


def abs_path(stored_path: str) -> Path:
    return DATA_DIR / stored_path


def delete_file(stored_path: str) -> None:
    path = abs_path(stored_path)
    if path.exists():
        path.unlink()
