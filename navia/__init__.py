"""Cienie Navii — webowa gra MMORPG oparta na GPS."""
import os

from flask import Flask, jsonify, send_from_directory

from . import config
from .db import close_db, init_db


def create_app():
    static_dir = os.path.join(config.BASE_DIR, "static")
    app = Flask(__name__, static_folder=static_dir, static_url_path="/static")
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    app.teardown_appcontext(close_db)

    from .api import bp as api_bp
    from .admin import bp as admin_bp
    app.register_blueprint(api_bp)
    app.register_blueprint(admin_bp)

    @app.get("/")
    def index():
        return send_from_directory(static_dir, "index.html")

    @app.get("/admin")
    def admin():
        return send_from_directory(static_dir, "admin.html")

    # Service worker musi być serwowany z katalogu głównego, żeby obejmował całą grę.
    @app.get("/sw.js")
    def sw():
        resp = send_from_directory(static_dir, "sw.js")
        resp.headers["Cache-Control"] = "no-cache"
        resp.headers["Service-Worker-Allowed"] = "/"
        return resp

    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(static_dir, "manifest.webmanifest", mimetype="application/manifest+json")

    @app.after_request
    def mark(resp):
        # Znacznik „to odpowiedź naszego serwera” — service worker nie zapisze w cache
        # strony zastępczej hostingu, gdy serwer dopiero się budzi.
        resp.headers["X-Navia"] = "1"
        return resp

    @app.errorhandler(404)
    def nf(_e):
        return jsonify({"error": "Nie znaleziono."}), 404

    init_db(app)
    return app
