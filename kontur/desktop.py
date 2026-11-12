"""Dependency-free Windows desktop host. Packaged using PyInstaller + Inno Setup."""
import argparse
import http.cookies
import json
import mimetypes
import os
import secrets
import subprocess
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .connections import executable
from .runner import Runner
from .service import Service
from .store import Error


def login_cli(provider):
    args = {"codex": ["login"], "claude": ["auth", "login"], "gh": ["auth", "login", "--web", "--git-protocol", "https"]}
    cmd = executable(provider) if provider in args else None
    if not cmd:
        raise Error("Сначала установите выбранный инструмент. Ссылки есть в настройках.")
    if os.name != "nt":
        raise Error("Вход из окна поддерживается на Windows; на других ОС используйте терминал.")
    subprocess.Popen(cmd + args[provider], creationflags=subprocess.CREATE_NEW_CONSOLE)


def make_server(service, port=0, preview=False):
    cookie = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    launch = secrets.token_urlsafe(32)
    assets = Path(__file__).parent / "static"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, data, content_type="application/json", extra=None):
            raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(raw)

        def dispatch(self, method):
            try:
                host = self.headers.get("Host", "")
                expected = "127.0.0.1:" + str(self.server.server_port)
                if not preview and host != expected:
                    raise Error("Недопустимый адрес", 403)
                url = urllib.parse.urlsplit(self.path)
                token = urllib.parse.parse_qs(url.query).get("launch", [""])[0]
                if method == "GET" and token and secrets.compare_digest(token, launch):
                    return self.send(302, b"", extra={"Location": "/", "Set-Cookie": "kontur=" + cookie + "; HttpOnly; SameSite=Strict; Path=/"})
                jar = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
                authenticated = preview or (jar.get("kontur") and secrets.compare_digest(jar["kontur"].value, cookie))
                if not authenticated:
                    raise Error("Откройте Контур через ярлык приложения", 401)
                if method == "POST":
                    origin = self.headers.get("Origin", "")
                    if (origin and origin != "http://" + expected and not preview) or not secrets.compare_digest(self.headers.get("X-Kontur-CSRF", ""), csrf):
                        raise Error("Запрос отклонён", 403)
                if method == "GET" and url.path == "/bootstrap":
                    return self.send(200, {"csrf": csrf, "mode": "desktop"})
                if url.path.startswith("/api/"):
                    body = None
                    if method == "POST":
                        length = int(self.headers.get("Content-Length", "0"))
                        if length > 8 * 1024 * 1024 or length < 0:
                            raise Error("Запрос слишком большой", 413)
                        body = json.loads(self.rfile.read(length))
                    return self.send(200, service.handle(method, url.path[4:], body))
                name = "index.html" if url.path == "/" else urllib.parse.unquote(url.path.removeprefix("/static/"))
                target = (assets / name).resolve()
                if method != "GET" or not target.is_relative_to(assets.resolve()) or not target.is_file():
                    raise Error("Не найдено", 404)
                mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
                if target.suffix in {".js", ".mjs"}:
                    mime = "text/javascript"
                return self.send(200, target.read_bytes(), mime + "; charset=utf-8")
            except Error as exc:
                self.send(exc.status, {"error": str(exc)})
            except (ValueError, TypeError, KeyError):
                self.send(400, {"error": "Некорректный запрос"})
            except Exception:
                self.send(500, {"error": "Операция не завершена. Данные сохранены; повторите после обновления."})

        def do_GET(self):
            self.dispatch("GET")

        def do_POST(self):
            self.dispatch("POST")

    server = ThreadingHTTPServer(("0.0.0.0" if preview else "127.0.0.1", port), Handler)
    return server, "http://127.0.0.1:" + str(server.server_port) + "/?launch=" + launch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--preview", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--data-dir")
    parser.add_argument("--smoke-test", action="store_true")
    args = parser.parse_args()
    root = Path(args.data_dir) if args.data_dir else Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share"))) / "Kontur"
    root.mkdir(parents=True, exist_ok=True)
    lock = None
    if not args.preview and not args.smoke_test:
        lock = (root / "instance.lock").open("a+b")
        lock.seek(0)
        if not lock.read(1):
            lock.write(b"1")
            lock.flush()
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            lock.close()
            try:
                info = json.loads((root / "instance.json").read_text())
                if info.get("url", "").startswith("http://127.0.0.1:"):
                    webbrowser.open(info["url"])
            except (OSError, ValueError):
                pass
            return
    service = Service(root)
    server, url = make_server(service, args.port, args.preview)
    if args.smoke_test:
        server.server_close()
        print("Kontur desktop smoke test: OK")
        return
    service.shutdown_callback = server.shutdown
    if not args.preview:
        info_file = root / "instance.json"
        info_file.write_text(json.dumps({"url":url}), encoding="utf-8")
        try:
            info_file.chmod(0o600)
        except OSError:
            pass
    runner = Runner(service)
    service.runner = runner
    runner.start()
    if not args.no_browser:
        launched = False
        if os.name == "nt":
            for env in ("PROGRAMFILES(X86)", "PROGRAMFILES"):
                edge = Path(os.environ.get(env, "C:/Program Files")) / "Microsoft/Edge/Application/msedge.exe"
                if edge.is_file():
                    subprocess.Popen([str(edge), "--app=" + url, "--user-data-dir=" + str(root / "browser"), "--no-first-run"])
                    launched = True
                    break
        if not launched:
            webbrowser.open(url)
    try:
        server.serve_forever()
    finally:
        runner.stop()
        server.server_close()
        if lock:
            (root / "instance.json").unlink(missing_ok=True)
            lock.close()


if __name__ == "__main__":
    main()
