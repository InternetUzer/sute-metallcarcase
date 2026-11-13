"""Real-process regression checks; also run against the packaged Windows EXE."""
import http.cookiejar
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

from kontur import desktop
from kontur.service import Service
from kontur.store import Error


class DesktopProcessTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "Контур data"
        self.root.mkdir()
        # Reproduce the existing 0.2.0 lock file, not just a clean installation.
        (self.root / "instance.lock").write_bytes(b"1")
        exe = os.environ.get("KONTUR_TEST_EXE")
        self.command = ([exe] if exe else [sys.executable, "-m", "kontur.desktop"]) + [
            "--no-browser", "--data-dir", str(self.root)]
        self.processes = []

    def tearDown(self):
        for proc in self.processes:
            if proc.poll() is None:
                proc.terminate()
            proc.wait(timeout=15)
        self.temp.cleanup()

    def start(self):
        proc = subprocess.Popen(self.command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(proc)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            self.assertIsNone(proc.poll(), "Primary instance exited during startup")
            try:
                self.url = json.loads((self.root / "instance.json").read_text())["url"]
                self.base = self.url.split("/?")[0]
                self.client = urllib.request.build_opener(
                    urllib.request.ProxyHandler({}),
                    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                with self.client.open(self.url, timeout=2) as response:
                    self.assertEqual(response.status, 200)
                self.csrf = self.request("/bootstrap")["csrf"]
                return proc
            except (OSError, ValueError, KeyError):
                time.sleep(0.1)
        self.fail("Primary instance never became ready")

    def request(self, path, data=None):
        req = urllib.request.Request(self.base + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json", "X-Kontur-CSRF": getattr(self, "csrf", "")})
        with self.client.open(req, timeout=5) as response:
            return json.load(response)

    def test_reopen_then_quit_and_restart_keeps_data(self):
        primary = self.start()
        original = (self.root / "instance.json").read_bytes()
        self.request("/api/record", {"id": "restart-project", "kind": "project",
            "data": {"title": "Saved before reopening"}, "expected": ""})
        for _ in range(3):
            second = subprocess.Popen(self.command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.processes.append(second)
            self.assertEqual(second.wait(timeout=20), 0, "Second launch must reuse the primary")
            self.assertIsNone(primary.poll())
            self.assertEqual((self.root / "instance.json").read_bytes(), original)
        self.request("/api/local/quit", {})
        self.assertEqual(primary.wait(timeout=15), 0)
        self.assertFalse((self.root / "instance.json").exists())
        restarted = self.start()
        self.assertNotEqual(self.url, json.loads(original)["url"])
        self.assertTrue(any(r["id"] == "restart-project" for r in self.request("/api/state")["records"]))
        self.request("/api/local/quit", {})
        self.assertEqual(restarted.wait(timeout=15), 0)

    def test_restart_after_process_crash(self):
        primary = self.start()
        old_url = self.url
        primary.terminate()
        primary.wait(timeout=15)
        self.assertTrue((self.root / "instance.json").exists())
        restarted = self.start()
        self.assertNotEqual(self.url, old_url)
        self.request("/api/local/quit", {})
        self.assertEqual(restarted.wait(timeout=15), 0)


class DesktopLifecycleTest(unittest.TestCase):
    def test_wait_for_first_instance_to_publish_address(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            url = "http://127.0.0.1:8765/?launch=test"
            timer = threading.Timer(0.1, lambda: (root / "instance.json").write_text(json.dumps({"url": url})))
            timer.start()
            try:
                self.assertEqual(desktop.instance_url(root, timeout=2), url)
            finally:
                timer.join()
            (root / "instance.json").write_text('{"url":"https://example.com/"}')
            with self.assertRaises(Error):
                desktop.instance_url(root, timeout=0)

    def test_second_launch_reopens_same_window_without_initializing_service(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            url = "http://127.0.0.1:8765/?launch=test"
            (root / "instance.json").write_text(json.dumps({"url": url}))
            with patch.object(sys, "argv", ["kontur", "--data-dir", d]), \
                    patch.object(desktop, "acquire_instance", return_value=None), \
                    patch.object(desktop, "open_window") as window, \
                    patch.object(desktop, "Service") as service:
                desktop.main()
                window.assert_called_once_with(root, url)
                service.assert_not_called()

    def test_startup_failure_releases_lock(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with patch.object(sys, "argv", ["kontur", "--no-browser", "--data-dir", d]), \
                    patch.object(desktop, "Service", side_effect=RuntimeError("test startup failure")):
                with self.assertRaises(RuntimeError):
                    desktop.main()
            lock = desktop.acquire_instance(root)
            self.assertIsNotNone(lock)
            lock.close()

    def test_patch_release_syncs_with_existing_cloud(self):
        with tempfile.TemporaryDirectory() as d:
            service = Service(d)
            service.store.set_setting("cloud_token", "test")
            service.store.set_setting("cloud_url", "https://example.test/kontur")
            with patch("kontur.service.reveal_secret", return_value="test"), \
                    patch("kontur.service.request_json", return_value={"accepted": [], "records": []}) as request:
                service.sync()
                self.assertEqual(request.call_args.args[2]["client_version"], "0.2.0")
                self.assertEqual(service.config()["version"], "0.2.1")


if __name__ == "__main__":
    unittest.main()
