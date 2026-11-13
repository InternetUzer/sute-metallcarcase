"""SQLite records with optimistic revisions, tombstones and lossless offline sync."""
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

KINDS = {"project", "task", "note", "message", "run", "conversation"}
ROLES = {"lead", "code", "deploy", "review", "chat"}
PROVIDERS = {"codex", "claude"}


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class Error(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def uid():
    return str(uuid.uuid4())


def validate(kind, data):
    if kind not in KINDS or not isinstance(data, dict):
        raise Error("Некорректный тип записи")
    if len(json.dumps(data, ensure_ascii=False)) > 180000:
        raise Error("Запись слишком большая", 413)
    if kind in {"project", "task", "note", "conversation"} and not str(data.get("title", "")).strip():
        raise Error("Укажите название")
    if len(str(data.get("title", ""))) > 240:
        raise Error("Название длиннее 240 символов")
    if kind != "project" and not isinstance(data.get("project"), str):
        raise Error("Не выбран проект")
    if kind == "run":
        if data.get("status") not in {"queued", "running", "done", "failed", "cancelled", "interrupted"}:
            raise Error("Некорректный статус запуска")
        if not isinstance(data.get("steps"), list) or not 1 <= len(data["steps"]) <= 4:
            raise Error("Нужен один исполнитель или цепочка до четырёх шагов")
        for step in data["steps"]:
            if not isinstance(step, dict) or step.get("role") not in ROLES or step.get("provider") not in PROVIDERS:
                raise Error("Неизвестная роль или помощник")
        if not str(data.get("prompt", "")).strip():
            raise Error("Напишите задачу помощнику")


class Store:
    def __init__(self, path, cloud=False):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.cloud = cloud
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript("""
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS records(
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL,
                rev TEXT NOT NULL, base_rev TEXT NOT NULL DEFAULT '',
                dirty INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
                updated REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS conflicts(
                id TEXT PRIMARY KEY, record_id TEXT NOT NULL, local TEXT NOT NULL,
                remote TEXT NOT NULL, created REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS audit(
                id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL,
                action TEXT NOT NULL, title TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS devices(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
                created REAL NOT NULL, seen REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS workers(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
                created REAL NOT NULL, seen REAL NOT NULL, state TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS worker_commands(
                id TEXT PRIMARY KEY, worker TEXT NOT NULL, action TEXT NOT NULL,
                args TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL,
                created REAL NOT NULL, expires REAL NOT NULL);
            """)
        if not self.setting("device_id"):
            self.set_setting("device_id", uid())

    def connect(self):
        db = sqlite3.connect(self.path, timeout=20, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        return db

    def setting(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_setting(self, key, value):
        with self.connect() as db:
            db.execute("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))

    @staticmethod
    def unpack(row):
        if row is None:
            return None
        record = dict(row)
        record["data"] = json.loads(record["data"])
        return record

    def get(self, record_id):
        with self.connect() as db:
            return self.unpack(db.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone())

    def all(self, deleted=False):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM records" + ("" if deleted else " WHERE deleted=0") + " ORDER BY updated").fetchall()
        return [self.unpack(r) for r in rows]

    def audit(self, action, title):
        with self.connect() as db:
            db.execute("INSERT INTO audit(at,action,title) VALUES(?,?,?)", (time.time(), action, title[:400]))

    def history(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 100")]

    def save(self, record_id, kind, data, expected, deleted=False):
        validate(kind, data)
        if not isinstance(record_id, str) or len(record_id) > 80 or not record_id:
            raise Error("Некорректный идентификатор")
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = self.unpack(db.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone())
            if (old["rev"] if old else "") != expected:
                raise Error("Запись уже изменилась. Обновите данные перед сохранением.", 409)
            if old and old["kind"] != kind:
                raise Error("Нельзя изменить тип записи")
            rev = uid()
            base = old["base_rev"] if old and old["dirty"] else (old["rev"] if old else "")
            row = dict(id=record_id, kind=kind, data=data, rev=rev,
                       base_rev=rev if self.cloud else base, dirty=0 if self.cloud else 1,
                       deleted=int(deleted), updated=time.time())
            self.write(db, row)
            db.execute("INSERT INTO audit(at,action,title) VALUES(?,?,?)", (time.time(), "Удаление" if deleted else "Сохранение", str(data.get("title", data.get("author", kind)))[:400]))
        return row

    @staticmethod
    def write(db, row):
        db.execute("""INSERT INTO records VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data,rev=excluded.rev,
          base_rev=excluded.base_rev,dirty=excluded.dirty,deleted=excluded.deleted,updated=excluded.updated""",
          (row["id"], row["kind"], json.dumps(row["data"], ensure_ascii=False), row["rev"], row["base_rev"],
           int(row["dirty"]), int(row["deleted"]), row["updated"]))

    def change(self, record_id, patch):
        with self.lock:
            row = self.get(record_id)
            if not row or row["deleted"]:
                raise Error("Запись не найдена", 404)
            return self.save(row["id"], row["kind"], {**row["data"], **patch}, row["rev"])

    def add_message(self, project, author, body, run=None, role=None, conversation=None):
        return self.save(uid(), "message", {"project": project, "author": author, "body": body[:120000],
             "run": run, "role": role, "at": time.time(), "conversation": conversation}, "")

    def accept_sync(self, incoming, cursor=None, paged=False, authorize=None):
        """Server CAS. Retries with the same revision are idempotent."""
        if not self.cloud or not isinstance(incoming, list) or len(incoming) > 5000:
            raise Error("Некорректный пакет синхронизации")
        accepted, conflicts = [], []
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in incoming:
                validate(row.get("kind"), row.get("data"))
                if not all(isinstance(row.get(k), str) and len(row[k]) <= 80 for k in ("id", "rev", "base_rev")) or not row["id"] or not row["rev"]:
                    raise Error("Некорректная версия записи")
                old = self.unpack(db.execute("SELECT * FROM records WHERE id=?", (row["id"],)).fetchone())
                if old and old["kind"] != row["kind"]:
                    raise Error("Тип записи отличается")
                if authorize and not authorize(db, old, row):
                    if old:
                        conflicts.append({"local": row, "remote": old})
                        continue
                    raise Error("Исполнитель не может записать эти данные", 403)
                if old and old["rev"] == row["rev"]:
                    accepted.append({"id": row["id"], "rev": row["rev"]})
                elif (old["rev"] if old else "") == row["base_rev"]:
                    clean = dict(id=row["id"], kind=row["kind"], data=row["data"], rev=row["rev"], base_rev=row["rev"], dirty=0,
                                 deleted=int(bool(row.get("deleted"))), updated=time.time())
                    self.write(db, clean)
                    accepted.append({"id": row["id"], "rev": row["rev"]})
                else:
                    conflicts.append({"local": row, "remote": old})
            if paged:
                rows=[];size=0;next_cursor=None
                for raw in db.execute("SELECT * FROM records WHERE id>? ORDER BY id", (cursor or '',)):
                    row=self.unpack(raw);cost=len(json.dumps(row,ensure_ascii=False).encode())
                    if rows and size+cost>512*1024:
                        next_cursor=rows[-1]['id'];break
                    rows.append(row);size+=cost
            else:
                rows = [self.unpack(r) for r in db.execute("SELECT * FROM records ORDER BY updated")]
                next_cursor=None
        return {"accepted": accepted, "conflicts": conflicts, "records": rows, "next_cursor":next_cursor}

    def merge_sync(self, payload):
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for ack in payload["accepted"]:
                db.execute("UPDATE records SET dirty=0,base_rev=rev WHERE id=? AND rev=?", (ack["id"], ack["rev"]))
                # A local edit made while the request was in flight must descend from the acknowledged version.
                db.execute("UPDATE records SET base_rev=? WHERE id=? AND dirty=1 AND rev!=?", (ack["rev"], ack["id"], ack["rev"]))
            for remote in payload["records"]:
                local = self.unpack(db.execute("SELECT * FROM records WHERE id=?", (remote["id"],)).fetchone())
                if not local or not local["dirty"]:
                    self.write(db, {**remote, "dirty": 0, "base_rev": remote["rev"]})
                elif remote["rev"] not in {local["base_rev"], local["rev"]}:
                    conflict_id = local["id"] + ":" + remote["rev"]
                    db.execute("INSERT INTO conflicts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET local=excluded.local",
                               (conflict_id, local["id"], json.dumps(local), json.dumps(remote), time.time()))
            # A server may reject an execution update even at the current base
            # revision (for example, an old laptop trying to finish a cloud run).
            for conflict in payload.get("conflicts", []):
                remote = conflict.get("remote")
                if not remote:
                    continue
                local = self.unpack(db.execute("SELECT * FROM records WHERE id=?", (remote["id"],)).fetchone())
                if local and local["dirty"]:
                    db.execute("INSERT INTO conflicts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET local=excluded.local",
                               (local["id"] + ":" + remote["rev"], local["id"], json.dumps(local), json.dumps(remote), time.time()))
        self.set_setting("last_sync", time.time())

    def conflicts(self):
        with self.connect() as db:
            return [{**dict(r), "local": json.loads(r["local"]), "remote": json.loads(r["remote"])} for r in db.execute("SELECT * FROM conflicts ORDER BY created")]

    def resolve(self, conflict_id, choice):
        if choice not in {"local", "remote", "both"}:
            raise Error("Выберите способ разрешения конфликта")
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            c = db.execute("SELECT * FROM conflicts WHERE id=?", (conflict_id,)).fetchone()
            if not c:
                raise Error("Конфликт уже разрешён", 404)
            local = self.unpack(db.execute("SELECT * FROM records WHERE id=?", (c["record_id"],)).fetchone())
            remote = json.loads(c["remote"])
            if choice == "local":
                self.write(db, {**local, "rev": uid(), "base_rev": remote["rev"], "dirty": 1})
            else:
                self.write(db, {**remote, "dirty": 0, "base_rev": remote["rev"]})
                if choice == "both":
                    self.write(db, {**local, "id": uid(), "rev": uid(), "base_rev": "", "dirty": 1,
                                   "data": {**local["data"], "title": local["data"].get("title", "Копия") + " — локальная копия"}})
            db.execute("DELETE FROM conflicts WHERE record_id=?", (c["record_id"],))

    def backup(self, destination):
        with self.connect() as source, sqlite3.connect(destination) as target:
            source.backup(target)

    def export(self):
        return {"format": "kontur-1", "exported": time.time(), "records": self.all(deleted=True)}

    def import_data(self, payload):
        if not isinstance(payload, dict) or payload.get("format") != "kontur-1" or not isinstance(payload.get("records"), list) or len(payload["records"]) > 5000:
            raise Error("Это не резервная копия Контура")
        # Validate the complete package before making any writes. Import creates a separate copy.
        rows = payload["records"]
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                raise Error("Повреждённая запись")
            validate(row.get("kind"), row.get("data"))
        mapping = {row["id"]: uid() for row in rows}
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in rows:
                if row.get("deleted"):
                    continue
                data = dict(row["data"])
                for field in ("project", "run", "conversation"):
                    if data.get(field):
                        data[field] = mapping.get(data[field], data[field])
                # Imported execution history can never silently run code again.
                if row["kind"] == "run" and data.get("status") in {"queued", "running"}:
                    data["status"] = "interrupted"
                rev = uid()
                self.write(db, dict(id=mapping[row["id"]], kind=row["kind"], data=data, rev=rev, base_rev=rev if self.cloud else "", dirty=0 if self.cloud else 1, deleted=0, updated=time.time()))
        self.audit("Импорт", "Восстановлена отдельная копия проектов")
        return len(rows)
