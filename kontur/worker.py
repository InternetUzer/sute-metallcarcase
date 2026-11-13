"""Headless Linux worker for the existing /kontur website (outbound HTTPS only)."""
import argparse
import getpass
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from .cloud_workers import REPO
from .connections import cli_probe, executable, protect_secret, request_json, reveal_secret
from .desktop import acquire_instance
from .runner import Runner
from .service import Service
from .store import Error


class WorkerService(Service):
    def __init__(self, root):
        super().__init__(root)
        self.sync_path = "/api/worker/sync"
        self.execution_lock = threading.Lock()

    def remote(self, route, body):
        token = reveal_secret(self.store.setting("cloud_token"))
        if not token:
            raise Error("Сначала выполните команду pair")
        return request_json(self.store.setting("cloud_url") + "/api/worker/" + route, token, body)

    def claim(self, record):
        result = self.remote("claim", {"id": record["id"], "rev": record["rev"]})
        self.store.merge_sync({"accepted": [], "records": [result["record"]]})
        return result["record"]

    def sync(self):
        result = super().sync()
        # A server-side cancellation wins over a late result from an offline worker.
        for conflict in self.store.conflicts():
            remote = conflict["remote"]
            if (remote["kind"] == "run" and remote["data"].get("device") == self.store.setting("device_id")
                    and remote["data"].get("status") in {"cancelled", "done", "failed", "interrupted"}):
                self.store.resolve(conflict["id"], "remote")
        return result

    def checkout(self, args):
        """Explicit clone only. Never pull, reset, or overwrite an existing checkout."""
        project = self.store.get(args.get("project", ""))
        repo = args.get("repo", "")
        if not project or project["deleted"] or project["kind"] != "project" or project["data"].get("repo") != repo or not REPO.fullmatch(repo):
            raise Error("Проект или его репозиторий изменился. Обновите страницу.")
        # Project IDs can be imported; use a hash instead of interpreting them as paths.
        from hashlib import sha256
        base = self.root / "projects"
        base.mkdir(exist_ok=True)
        target = base / sha256(project["id"].encode()).hexdigest()[:24]
        repos = self.store.setting("checkout_repos", {})
        if target.exists():
            if repos.get(project["id"]) != repo or not (target / ".git").is_dir() or target.is_symlink():
                raise Error("Папка уже занята. Существующие файлы не изменены; проверьте сервер.")
        else:
            gh = executable("gh")
            if not gh:
                raise Error("Установите GitHub CLI на сервере и выполните вход")
            with tempfile.TemporaryDirectory(prefix="checkout-", dir=base) as staging:
                cloned = Path(staging) / "repo"
                try:
                    result = subprocess.run(gh + ["repo", "clone", repo, str(cloned)],
                                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                            stderr=subprocess.DEVNULL, timeout=300)
                except subprocess.TimeoutExpired:
                    raise Error("Клонирование не завершилось за пять минут") from None
                if result.returncode:
                    raise Error("Не удалось клонировать репозиторий. Проверьте вход GitHub и права на сервере.")
                cloned.rename(target)
            repos[project["id"]] = repo
            self.store.set_setting("checkout_repos", repos)
        paths = self.store.setting("paths", {})
        paths[project["id"]] = str(target)
        self.store.set_setting("paths", paths)
        return {"project": project["id"], "repo": repo, "ready": True}

    def command(self, command):
        action, args = command["action"], command["args"]
        if action == "repos":
            return self.github.repos(args.get("owner"), args.get("page", 1))
        if action == "summary":
            return self.github.summary(args.get("repo"))
        if action == "checkout":
            self.sync()
            return self.checkout(args)
        raise Error("Неизвестная команда")


class WorkerRunner(Runner):
    def can_execute(self):
        return (self.store.setting("execution_worker") == self.store.setting("device_id")
                and time.time() - self.store.setting("heartbeat_at", 0) < 45)

    def execute(self, original):
        # A checkout must not race an agent changing files in the same repository.
        with self.service.execution_lock:
            if self.can_execute():
                return super().execute(original)

def pair(service, url):
    import urllib.parse
    url = url.rstrip("/")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise Error("Нужен HTTPS-адрес Контура без пароля и параметров")
    token = getpass.getpass("Ключ облачного исполнителя (ввод скрыт): ").strip()
    result = request_json(url + "/api/worker/heartbeat", token, {"providers": {}, "projects": [], "busy": True})
    old = service.store.setting("cloud_token")
    if old and (service.store.setting("cloud_url") != url or service.store.setting("device_id") != result["id"]):
        raise Error("Для другого исполнителя используйте новый --data-dir; текущие данные сохранены")
    service.store.set_setting("device_id", result["id"])
    service.store.set_setting("cloud_url", url)
    service.store.set_setting("cloud_token", protect_secret(token))
    service.store.set_setting("worker_enabled", True)
    print("Сервер связан с Контуром. Ключ не включается в экспорт или журнал.")


def run(service):
    if not service.store.setting("cloud_token"):
        raise Error("Сначала выполните pair")
    # The first successful sync precedes crash recovery and all execution.
    service.sync()
    runner = WorkerRunner(service)
    service.runner = runner
    runner.start()
    stopping = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stopping.set())
    probes, probed_at, pending = {}, 0, None
    try:
        while not stopping.is_set():
            locked = False
            try:
                if time.time() - probed_at > 60:
                    probes = {p: cli_probe(p) for p in ("codex", "claude", "gh")}
                    probed_at = time.time()
                if pending:
                    service.remote("result", pending)
                    pending = None
                locked = service.execution_lock.acquire(blocking=False)
                reply = service.remote("heartbeat", {"providers": probes,
                    "projects": [k for k, path in service.store.setting("paths", {}).items() if Path(path).is_dir()],
                    "busy": not locked})
                if reply["id"] != service.store.setting("device_id"):
                    raise Error("Ключ принадлежит другому исполнителю", 403)
                service.store.set_setting("execution_worker", reply["id"] if reply["enabled"] else "")
                service.store.set_setting("heartbeat_at", time.time())
                command = reply.get("command")
                if command and locked:
                    try:
                        result = service.command(command)
                        pending = {"id": command["id"], "status": "done", "result": result}
                    except (Error, OSError, ValueError, subprocess.SubprocessError):
                        pending = {"id": command["id"], "status": "failed", "result": {
                            "error": "Команда не завершена. Проверьте вход GitHub, права и настройки проекта на сервере."}}
                    service.remote("result", pending)
                    pending = None
            except Error as exc:
                # Never print request payloads, URLs containing credentials, or CLI stderr.
                print("Нет связи с Контуром; новые задания ожидают подключения.", flush=True)
                if exc.status in {401, 403}:
                    runner.stop()
                    raise Error("Доступ сервера отозван или ключ недействителен", exc.status) from None
            finally:
                if locked:
                    service.execution_lock.release()
            stopping.wait(5)
    finally:
        runner.stop()
        if runner.thread:
            runner.thread.join(timeout=35)
        try:
            service.sync()
        except Error:
            pass


def main():
    parser = argparse.ArgumentParser(description="Облачный исполнитель Контура")
    parser.add_argument("--data-dir", type=Path, default=Path.home() / ".local/share/kontur-worker")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("pair").add_argument("--url", required=True)
    sub.add_parser("run")
    sub.add_parser("doctor")
    sub.add_parser("login").add_argument("provider", choices=["codex", "claude", "gh"])
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("Облачный исполнитель предназначен для Linux; на Windows используйте приложение")
    os.umask(0o077)
    root = args.data_dir.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = acquire_instance(root)
    if lock is None:
        parser.error("Исполнитель уже работает. Перед входом или перенастройкой остановите его службу.")
    try:
        service = WorkerService(root)
        if args.command == "pair":
            pair(service, args.url)
        elif args.command == "run":
            run(service)
        elif args.command == "doctor":
            print(json.dumps({"python": sys.version.split()[0], "paired": bool(service.store.setting("cloud_token")),
                "providers": {p: cli_probe(p) for p in ("codex", "claude", "gh")}}, ensure_ascii=False, indent=2))
        else:
            cmd = executable(args.provider)
            if not cmd:
                raise Error("Сначала установите выбранный официальный CLI")
            login = {"codex": ["login", "--device-auth"], "claude": ["auth", "login"],
                     "gh": ["auth", "login", "--web", "--git-protocol", "https", "--hostname", "github.com"]}
            # The official CLI owns the entire interactive sign-in and credential store.
            result = subprocess.run(cmd + login[args.provider])
            if result.returncode:
                raise Error("Вход не завершён. Проверьте сообщение официального CLI.")
    except Error as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        lock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
