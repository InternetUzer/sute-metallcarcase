"""Authenticated outbound workers. No provider credentials cross this boundary."""
import json
import re
import secrets
import time

from .connections import token_hash
from .store import Error, uid

ONLINE_SECONDS = 60
COMMAND_SECONDS = 600
REPO = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*")


class CloudWorkers:
    def __init__(self, store):
        self.store = store

    def authenticate(self, token):
        if not token or len(token) > 200:
            return None
        with self.store.connect() as db:
            row = db.execute("SELECT id FROM workers WHERE hash=?", (token_hash(token),)).fetchone()
        return row["id"] if row else None

    def active(self):
        return self.store.setting("execution_worker", "")

    def list(self):
        with self.store.connect() as db:
            rows = db.execute("SELECT id,name,created,seen,state FROM workers ORDER BY created").fetchall()
        return [{**dict(row), "state": json.loads(row["state"]),
                 "online": time.time() - row["seen"] < ONLINE_SECONDS} for row in rows]

    @staticmethod
    def busy(db):
        return any(json.loads(r[0]).get("status") == "running" for r in
                   db.execute("SELECT data FROM records WHERE kind='run' AND deleted=0"))

    def select(self, worker):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if self.busy(db):
                raise Error("Дождитесь завершения или остановите текущие задания перед сменой исполнителя", 409)
            if worker:
                row = db.execute("SELECT seen FROM workers WHERE id=?", (worker,)).fetchone()
                if not row or time.time() - row[0] >= ONLINE_SECONDS:
                    raise Error("Сначала подключите облачного исполнителя", 409)
            db.execute("INSERT INTO settings VALUES('execution_worker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (json.dumps(worker),))
        return {"ok": True}

    def handle(self, path, body):
        """Owner-only operations; Flask enforces admin session and CSRF."""
        s = self.store
        if path == "/workers/create":
            token = secrets.token_urlsafe(40)
            worker = uid()
            with s.connect() as db:
                db.execute("INSERT INTO workers VALUES(?,?,?,?,?,?)",
                           (worker, str(body.get("name", "Облачный сервер"))[:100], token_hash(token), time.time(), 0, "{}"))
            return {"id": worker, "token": token}
        if path == "/workers/select":
            worker = body.get("id", "")
            if not isinstance(worker, str):
                raise Error("Некорректный исполнитель")
            return self.select(worker)
        if path == "/workers/revoke":
            worker = body.get("id")
            with s.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("DELETE FROM workers WHERE id=?", (worker,))
                db.execute("DELETE FROM worker_commands WHERE worker=?", (worker,))
            # Do not silently route outstanding cloud work to a laptop.
            return {"ok": True}
        if path == "/workers/command":
            worker = self.active()
            if not any(w["id"] == worker and w["online"] for w in self.list()):
                raise Error("Облачный исполнитель не на связи", 409)
            action = body.get("action")
            args = body.get("args", {})
            if not isinstance(args, dict):
                raise Error("Некорректные параметры")
            if action == "repos":
                owner, page = args.get("owner", "InternetUzer"), args.get("page", 1)
                if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", owner):
                    raise Error("Укажите логин GitHub")
                if type(page) is not int or not 1 <= page <= 20:
                    raise Error("Некорректная страница")
                args = {"owner": owner, "page": page}
            elif action == "summary":
                if not isinstance(args.get("repo"), str) or not REPO.fullmatch(args["repo"]):
                    raise Error("Некорректный репозиторий")
                args = {"repo": args["repo"]}
            elif action == "checkout":
                project = s.get(args.get("project", ""))
                if not project or project["deleted"] or project["kind"] != "project" or not REPO.fullmatch(project["data"].get("repo", "")):
                    raise Error("Сначала укажите GitHub-репозиторий проекта")
                args = {"project": project["id"], "repo": project["data"]["repo"]}
            else:
                raise Error("Неизвестная команда")
            command_id = body.get("request_id")
            if not isinstance(command_id, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", command_id):
                raise Error("Некорректный идентификатор команды")
            now = time.time()
            with s.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                old = db.execute("SELECT * FROM worker_commands WHERE id=?", (command_id,)).fetchone()
                if old:
                    if old["worker"] != worker or old["action"] != action or json.loads(old["args"]) != args:
                        raise Error("Идентификатор уже занят", 409)
                    return {"id": command_id}
                if db.execute("SELECT COUNT(*) FROM worker_commands WHERE worker=? AND status IN ('queued','running') AND expires>?", (worker, now)).fetchone()[0] >= 20:
                    raise Error("Слишком много команд в очереди", 429)
                db.execute("INSERT INTO worker_commands VALUES(?,?,?,?,?,?,?,?)",
                           (command_id, worker, action, json.dumps(args), "queued", "{}", now, now + COMMAND_SECONDS))
            return {"id": command_id}
        if path == "/workers/result":
            with s.connect() as db:
                row = db.execute("SELECT * FROM worker_commands WHERE id=?", (body.get("id"),)).fetchone()
            if not row:
                raise Error("Команда не найдена", 404)
            if row["expires"] < time.time() and row["status"] in {"queued", "running"}:
                return {"status": "expired", "result": {"error": "Время ожидания истекло. Проверьте состояние сервера перед повтором."}}
            return {"status": row["status"], "result": json.loads(row["result"])}
        raise Error("Маршрут не найден", 404)

    def heartbeat(self, worker, body):
        providers = body.get("providers", {})
        if not isinstance(providers, dict):
            raise Error("Некорректный статус")
        state = {"providers": {}}
        for name in ("codex", "claude", "gh"):
            p = providers.get(name, {})
            if not isinstance(p, dict):
                raise Error("Некорректный статус")
            installed, authenticated = p.get("installed") is True, p.get("authenticated") is True
            state["providers"][name] = {"installed": installed, "authenticated": installed and authenticated,
                "label": "Подключён" if installed and authenticated else "Нужен вход на сервере" if installed else "Не установлен на сервере"}
        projects = body.get("projects", [])
        if not isinstance(projects, list) or len(projects) > 5000 or any(not isinstance(p, str) or len(p) > 80 for p in projects):
            raise Error("Некорректные проекты")
        state["projects"] = projects
        state["busy"] = body.get("busy") is True
        now = time.time()
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("UPDATE workers SET seen=?,state=? WHERE id=?", (now, json.dumps(state), worker)).rowcount:
                raise Error("Доступ исполнителя отозван", 401)
            # Bound storage; timed-out commands are never automatically replayed.
            db.execute("DELETE FROM worker_commands WHERE expires<?", (now - 86400,))
            command = None
            if not state["busy"]:
                row = db.execute("SELECT * FROM worker_commands WHERE worker=? AND status='queued' AND expires>? ORDER BY created LIMIT 1", (worker, now)).fetchone()
                if row:
                    db.execute("UPDATE worker_commands SET status='running' WHERE id=?", (row["id"],))
                    command = {"id": row["id"], "action": row["action"], "args": json.loads(row["args"])}
        return {"id": worker, "enabled": self.active() == worker, "command": command}

    def result(self, worker, body):
        result = body.get("result")
        if not isinstance(result, dict) or len(json.dumps(result)) > 256 * 1024 or body.get("status") not in {"done", "failed"}:
            raise Error("Некорректный результат")
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM worker_commands WHERE id=? AND worker=?", (body.get("id"), worker)).fetchone()
            if not row or row["status"] not in {"running", "done", "failed"}:
                raise Error("Команда не найдена или не была получена", 409)
            if row["status"] == "running":
                db.execute("UPDATE worker_commands SET status=?,result=? WHERE id=?", (body["status"], json.dumps(result), row["id"]))
        return {"ok": True}

    def claim(self, worker, body):
        s = self.store
        with s.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT id FROM workers WHERE id=?", (worker,)).fetchone():
                raise Error("Доступ исполнителя отозван", 401)
            active = db.execute("SELECT value FROM settings WHERE key='execution_worker'").fetchone()
            if not active or json.loads(active[0]) != worker:
                raise Error("Выбран другой исполнитель", 409)
            row = s.unpack(db.execute("SELECT * FROM records WHERE id=?", (body.get("id"),)).fetchone())
            if not row or row["deleted"] or row["kind"] != "run" or row["rev"] != body.get("rev") or row["data"].get("status") != "queued":
                raise Error("Задание уже занято или изменилось", 409)
            # Claim and switch share a SQLite transaction, also across WSGI processes.
            row["data"] = {**row["data"], "status": "running", "device": worker, "executor": "cloud", "started": time.time()}
            row.update(rev=uid(), updated=time.time())
            row["base_rev"] = row["rev"]
            s.write(db, row)
        return {"record": row}

    @staticmethod
    def allow_sync(worker, db, old, row):
        if row.get("deleted"):
            return False
        if row["kind"] == "run":
            if not old or old["data"].get("device") != worker or old["data"].get("executor") != "cloud":
                return False
            mutable = {"status", "step", "error", "finished"}
            if {k: v for k, v in row["data"].items() if k not in mutable} != {k: v for k, v in old["data"].items() if k not in mutable}:
                return False
            if row["data"]["status"] == "queued":
                return False
            if old["data"]["status"] in {"cancelled", "done", "failed", "interrupted"}:
                return old["data"] == row["data"]
            return True
        if row["kind"] == "message" and not old:
            run = db.execute("SELECT data FROM records WHERE id=? AND kind='run' AND deleted=0", (row["data"].get("run"),)).fetchone()
            if not run:
                return False
            run = json.loads(run[0])
            return (run.get("executor") == "cloud" and run.get("device") == worker
                    and row["data"].get("project") == run.get("project")
                    and row["data"].get("conversation") == run.get("conversation")
                    and row["data"].get("author") in {"codex", "claude", "system"})
        return old is not None and row["rev"] == old["rev"]

    @staticmethod
    def allow_desktop_sync(db, old, row):
        if row["kind"] != "run":
            return True
        if old and old["data"].get("executor") == "cloud":
            return row["rev"] == old["rev"]
        active = db.execute("SELECT value FROM settings WHERE key='execution_worker'").fetchone()
        if active and json.loads(active[0]):
            if old:
                return row["rev"] == old["rev"]
            return (row["data"].get("status") == "queued" and not row["data"].get("device")
                    and not row["data"].get("executor"))
        return not row["data"].get("executor")
