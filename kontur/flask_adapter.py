"""Mount below /kontur; existing site's admin authentication remains authoritative."""
import json
from pathlib import Path

from .service import Service
from .store import Error


def register(app, csrf_token):
    from flask import Blueprint, abort, g, jsonify, redirect, request, send_from_directory, session
    import secrets
    service = Service(Path(app.config["DATA_DIR"]) / "kontur", cloud=True)
    app.extensions["kontur"] = service
    bp = Blueprint("kontur", __name__, url_prefix="/kontur")
    assets = Path(__file__).parent / "static"

    @bp.before_request
    def access():
        token = request.headers.get("Authorization", "").removeprefix("Bearer ")
        g.kontur_device = service.device_auth(token) if token else False
        g.kontur_worker = service.workers.authenticate(token) if token else None
        if g.kontur_worker:
            if request.path not in {"/kontur/api/health", "/kontur/api/worker/heartbeat",
                                    "/kontur/api/worker/sync", "/kontur/api/worker/claim", "/kontur/api/worker/result"}:
                abort(403)
            return
        if g.kontur_device:
            if request.path not in {"/kontur/api/health", "/kontur/api/sync", "/kontur/api/claim"}:
                abort(403)
            return
        if not g.user:
            if "/api/" in request.path or request.path.endswith("/bootstrap"):
                return jsonify(error="Войдите в кабинет владельца сайта", login="/login"), 401
            return redirect("/login")
        if g.user["role"] != "admin":
            abort(403)
        if request.method == "POST":
            origin = request.headers.get("Origin")
            if origin and origin != request.host_url.rstrip("/"):
                abort(403)
            provided = request.headers.get("X-Kontur-CSRF", "")
            if not provided or not secrets.compare_digest(provided, session.get("csrf", "")):
                abort(403)

    @bp.get("")
    @bp.get("/")
    def home():
        if not request.path.endswith("/"):
            return redirect("/kontur/")
        return send_from_directory(assets, "index.html")

    @bp.get("/static/<path:name>")
    def static(name):
        return send_from_directory(assets, name)

    @bp.get("/bootstrap")
    def bootstrap():
        return {"csrf": csrf_token(), "mode": "cloud"}

    @bp.route("/api/<path:route>", methods=["GET", "POST"])
    def api(route):
        if request.content_length and request.content_length > 8 * 1024 * 1024:
            abort(413)
        try:
            body = request.get_json(silent=True) if request.method == "POST" else None
            if request.method == "POST" and not isinstance(body, dict):
                raise Error("Ожидался JSON-объект")
            if route.startswith("worker/"):
                if request.method != "POST" or not g.kontur_worker:
                    abort(403)
                return jsonify(service.worker_request(g.kontur_worker, "/" + route, body))
            if route == "claim" and g.kontur_device:
                body["device"] = body.get("device", g.kontur_device)
            return jsonify(service.handle(request.method, "/" + route, body))
        except Error as exc:
            return jsonify(error=str(exc)), exc.status

    @bp.after_request
    def private(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response

    app.register_blueprint(bp)
