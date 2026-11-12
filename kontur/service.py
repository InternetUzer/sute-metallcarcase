import json
import os
import secrets
import threading
import time
import urllib.parse
from pathlib import Path

from . import __version__
from .connections import GitHub, cli_probe, protect_secret, reveal_secret, request_json, token_hash
from .store import Error, Store, uid


class Service:
    def __init__(self, data_dir, cloud=False):
        self.root = Path(data_dir)
        self.store = Store(self.root / "kontur.sqlite3", cloud)
        self.cloud = cloud
        self.github = GitHub(not cloud)
        self.sync_lock = threading.Lock()
        self.runner = None
        self.probes = None
        self.probes_at = 0
        self.sync_error = ""
        if not cloud:
            try:
                self.root.chmod(0o700)
                self.store.path.chmod(0o600)
            except OSError:
                pass

    def config(self):
        return {"mode": "cloud" if self.cloud else "desktop", "version": __version__,
                "device": self.store.setting("device_id"), "cloud_url": self.store.setting("cloud_url", "https://metalcarcase.ru/kontur"),
                "paired": bool(self.store.setting("cloud_token")), "last_sync": self.store.setting("last_sync"),
                "sync_error": self.sync_error, "worker": self.store.setting("worker_enabled", False),
                "github_owner": self.store.setting("github_owner", "InternetUzer"),
                "paths": {} if self.cloud else self.store.setting("paths", {})}

    def sync(self):
        if self.cloud:
            return {"ok": True}
        if not self.sync_lock.acquire(blocking=False):
            return {"ok": True, "busy": True}
        try:
            token = reveal_secret(self.store.setting("cloud_token"))
            if not token:
                raise Error("Подключите облачную версию в настройках", 409)
            dirty = [r for r in self.store.all(True) if r["dirty"]]
            result = request_json(self.store.setting("cloud_url") + "/api/sync", token, {"records": dirty})
            self.store.merge_sync(result)
            self.sync_error = ""
            return {"ok": True, "conflicts": len(self.store.conflicts())}
        except Error as exc:
            self.sync_error = str(exc)
            raise
        finally:
            self.sync_lock.release()

    def claim(self, record):
        """A paired desktop obtains a cloud CAS claim before any execution."""
        if self.store.setting("cloud_token"):
            token = reveal_secret(self.store.setting("cloud_token"))
            reply = request_json(self.store.setting("cloud_url") + "/api/claim", token,
                {"id": record["id"], "rev": record["rev"], "device": self.store.setting("device_id")})
            self.store.merge_sync({"accepted": [], "records": [reply["record"]]})
            return reply["record"]
        return self.store.save(record["id"], "run", {**record["data"], "status": "running", "device": self.store.setting("device_id"), "started": time.time()}, record["rev"])

    def handle(self, method, path, body=None):
        body = body or {}
        s = self.store
        if method == "GET" and path == "/state":
            return {"records": s.all(), "config": self.config(), "conflicts": s.conflicts(), "history": s.history()}
        if method == "GET" and path == "/health":
            return {"ok": True, "version": __version__, "mode": "cloud" if self.cloud else "desktop"}
        if method == "GET" and path == "/export":
            return s.export()
        if method == "GET" and path == "/connections":
            if not self.cloud and (not self.probes or time.time() - self.probes_at > 15):
                self.probes = {name: cli_probe(name) for name in ("codex", "claude", "gh")}
                self.probes_at = time.time()
            return {"providers": self.probes or {}, "mode": self.config()["mode"]}
        if method != "POST":
            raise Error("Маршрут не найден", 404)
        if not isinstance(body, dict):
            raise Error("Ожидался JSON-объект")
        if path == "/record":
            old = s.get(body.get("id", ""))
            # State transitions for execution are server-owned; ordinary clients create queued runs.
            if body.get("kind") == "run":
                if old or body.get("data", {}).get("status") != "queued":
                    raise Error("Используйте управление запуском")
                data = body["data"]
                project = s.get(data.get("project", ""))
                if not project or project["deleted"] or project["kind"] != "project":
                    raise Error("Проект не найден", 404)
            row = s.save(body.get("id", ""), body.get("kind"), body.get("data"), body.get("expected", ""), body.get("deleted", False))
            return {"record": row}
        if path == "/import":
            backup_dir = self.root / "backups"
            backup_dir.mkdir(exist_ok=True)
            s.backup(backup_dir / (str(time.time_ns()) + ".sqlite3"))
            return {"count": s.import_data(body)}
        if path == "/resolve":
            s.resolve(body.get("id"), body.get("choice"))
            return {"ok": True}
        if path == "/github/repos":
            return self.github.repos(body.get("owner", "InternetUzer"), body.get("page", 1))
        if path == "/github/summary":
            return self.github.summary(body.get("repo"))
        if path == "/sync":
            return s.accept_sync(body.get("records")) if self.cloud else self.sync()
        if path == "/claim" and self.cloud:
            with s.lock:
                row = s.get(body.get("id", ""))
                if not row or row["kind"] != "run" or row["deleted"] or row["rev"] != body.get("rev") or row["data"]["status"] != "queued":
                    raise Error("Задание уже занято или изменилось", 409)
                return {"record": s.change(row["id"], {"status": "running", "device": body.get("device"), "started": time.time()})}
        if path == "/cancel":
            row = s.get(body.get("id", ""))
            if not row or row["kind"] != "run":
                raise Error("Запуск не найден", 404)
            if self.runner:
                self.runner.cancel(row["id"])
            return {"record": s.change(row["id"], {"status": "cancelled", "finished": time.time()})}
        if path == "/settings":
            if self.cloud:
                raise Error("Настройки устройства меняются на ноутбуке", 409)
            if "cloud_url" in body:
                url = str(body["cloud_url"]).rstrip("/")
                p = urllib.parse.urlsplit(url)
                if p.scheme != "https" or not p.hostname or p.username or p.password or p.query or p.fragment:
                    raise Error("Нужен HTTPS-адрес облачной версии без пароля и параметров")
                # Pair only after checking credentials; never send an old key to a newly entered host.
                token = str(body.get("cloud_token", "")).strip()
                if not token:
                    raise Error("Вставьте новый ключ устройства из облачной версии")
                reply = request_json(url + "/api/health", token)
                if reply.get("mode") != "cloud":
                    raise Error("Адрес не является облачной версией Контура")
                s.set_setting("cloud_url", url)
                s.set_setting("cloud_token", protect_secret(token))
            for key in ("worker_enabled", "github_owner"):
                if key in body:
                    if key == "worker_enabled" and not isinstance(body[key], bool):
                        raise Error("Неверная настройка исполнителя")
                    s.set_setting(key, body[key])
            return {"config": self.config()}
        if path == "/local/path" and not self.cloud:
            record = s.get(body.get("project", ""))
            if not record or record["kind"] != "project":
                raise Error("Проект не найден", 404)
            folder = Path(str(body.get("path", ""))).expanduser()
            if not folder.is_absolute() or not folder.is_dir():
                raise Error("Укажите существующую абсолютную папку проекта")
            paths = s.setting("paths", {})
            paths[record["id"]] = str(folder.resolve())
            s.set_setting("paths", paths)
            return {"ok": True}
        if path == "/local/open" and not self.cloud:
            folder = s.setting("paths", {}).get(body.get("project"))
            if not folder or not Path(folder).is_dir():
                raise Error("Сначала выберите локальную папку проекта")
            import webbrowser
            webbrowser.open("vscode://file/" + urllib.parse.quote(str(Path(folder).resolve()).replace("\\", "/"), safe="/:"))
            return {"ok": True}
        if path == "/local/login" and not self.cloud:
            from .desktop import login_cli
            login_cli(body.get("provider"))
            self.probes = None
            return {"ok": True}
        if path == "/devices" and self.cloud:
            token = secrets.token_urlsafe(40)
            now = time.time()
            with s.connect() as db:
                device_id = uid()
                db.execute("INSERT INTO devices VALUES(?,?,?,?,?)", (device_id, str(body.get("name", "Ноутбук"))[:100], token_hash(token), now, now))
            return {"token": token, "id": device_id}
        if path == "/devices/revoke" and self.cloud:
            with s.connect() as db:
                db.execute("DELETE FROM devices WHERE id=?", (body.get("id"),))
            return {"ok": True}
        if path == "/devices/list" and self.cloud:
            with s.connect() as db:
                return {"devices": [dict(r) for r in db.execute("SELECT id,name,created,seen FROM devices")]}
        raise Error("Функция недоступна в этой версии", 404)

    def device_auth(self, token):
        if not token or len(token) > 200:
            return False
        with self.store.connect() as db:
            row = db.execute("SELECT id FROM devices WHERE hash=?", (token_hash(token),)).fetchone()
            if row:
                db.execute("UPDATE devices SET seen=? WHERE id=?", (time.time(), row["id"]))
                return row["id"]
        return False
