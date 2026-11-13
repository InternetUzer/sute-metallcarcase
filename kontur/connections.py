"""Bounded HTTPS integrations; subscription credentials stay in official CLIs."""
import base64
import ctypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request

from .store import Error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Error("Сервер перенаправил запрос. Укажите окончательный HTTPS-адрес.", 502)


def request_json(url, token=None, data=None, method=None):
    headers = {"Accept": "application/json", "User-Agent": "Kontur/0.1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=25) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise Error("Ответ слишком большой", 502)
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        if exc.code == 426:
            raise Error('Обновите Контур на ноутбуке до версии 0.2.0.',426) from None
        if exc.code in {401, 403}:
            raise Error("Нет доступа. Проверьте подключение и права аккаунта.", 401) from None
        if exc.code == 409:
            raise Error("Задание уже изменено или занято другим устройством", 409) from None
        raise Error("Сервис вернул HTTP " + str(exc.code), 502) from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise Error("Нет соединения с сервисом. Локальные данные сохранены.", 503) from None


def protect_secret(value):
    if os.name != "nt":
        return "local:" + base64.b64encode(value.encode()).decode()
    return "dpapi:" + base64.b64encode(_dpapi(value.encode(), False)).decode()


def reveal_secret(value):
    if not value:
        return ""
    prefix, raw = value.split(":", 1)
    data = base64.b64decode(raw)
    return (_dpapi(data, True) if prefix == "dpapi" else data).decode()


def _dpapi(data, decrypt):
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]
    buf = ctypes.create_string_buffer(data)
    src = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    dst = Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(src), None, None, None, None, 1, ctypes.byref(dst)):
        raise Error("Windows не смог сохранить ключ подключения")
    try:
        return ctypes.string_at(dst.pbData, dst.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(dst.pbData)


def executable(name):
    found = shutil.which(name)
    if not found:
        return None
    # Never feed user text to cmd.exe. Resolve known npm shims directly to Node.
    if found.lower().endswith((".cmd", ".bat")):
        from pathlib import Path
        module = {"codex": "@openai/codex/bin/codex.js", "claude": "@anthropic-ai/claude-code/cli.js"}.get(name)
        if module:
            target = Path(found).parent / "node_modules" / module
            node = shutil.which("node")
            if target.is_file() and node:
                return [node, str(target)]
        return None
    return [found]


def cli_probe(name):
    cmd = executable(name)
    if not cmd:
        return {"installed": False, "authenticated": False, "label": "Не установлен"}
    args = {"codex": ["login", "status"], "claude": ["auth", "status"], "gh": ["auth", "status"]}[name]
    try:
        p = subprocess.run(cmd + args, capture_output=True, timeout=8,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return {"installed": True, "authenticated": p.returncode == 0, "label": "Подключён" if p.returncode == 0 else "Нужен вход"}
    except (OSError, subprocess.TimeoutExpired):
        return {"installed": True, "authenticated": False, "label": "Проверка не завершена"}


class GitHub:
    def __init__(self, local):
        self.local = local

    def token(self):
        if not self.local:
            return os.environ.get("KONTUR_GITHUB_TOKEN", "")
        cmd = executable("gh")
        if cmd:
            try:
                p = subprocess.run(cmd + ["auth", "token"], capture_output=True, timeout=8,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if p.returncode == 0:
                    return p.stdout.decode().strip()
            except (OSError, subprocess.TimeoutExpired):
                pass
        return ""

    def repos(self, owner, page=1):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", owner or ""):
            raise Error("Укажите логин GitHub")
        page = max(1, min(20, int(page)))
        token = self.token()
        path = "/user/repos?affiliation=owner,collaborator,organization_member" if token else "/users/" + owner + "/repos?type=owner"
        rows = request_json("https://api.github.com" + path + "&sort=updated&per_page=50&page=" + str(page), token)
        return {"authenticated": bool(token), "next_page": page + 1 if len(rows) == 50 else None,
                "repos": [{"name": r["name"], "full_name": r["full_name"], "description": r.get("description") or "",
                           "private": r["private"], "url": r["html_url"], "branch": r["default_branch"], "language": r.get("language"),
                           "updated": r["updated_at"]} for r in rows]}

    def summary(self, repo):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo or ""):
            raise Error("Некорректное имя репозитория")
        token = self.token()
        base = "https://api.github.com/repos/" + repo
        info = request_json(base, token)
        issues = request_json(base + "/issues?state=open&per_page=10", token)
        return {"repo": repo, "branch": info["default_branch"], "updated": info["pushed_at"], "url": info["html_url"],
                "open_issues": info["open_issues_count"],
                "issues": [{"title": x["title"], "url": x["html_url"], "number": x["number"], "pr": "pull_request" in x} for x in issues]}


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()
