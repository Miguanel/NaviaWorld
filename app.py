"""Uruchomienie serwera gry:  python app.py   →  http://localhost:5000

Na telefonie w tej samej sieci Wi-Fi wejdź na  http://<IP-komputera>:5000
(GPS w przeglądarce wymaga HTTPS albo localhost — patrz README).
"""
import os
import sys

from navia import create_app
from navia import config

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    use_https = "--https" in sys.argv
    print(f"\n  {config.GAME_NAME} — serwer wstaje na porcie {port}")
    print(f"  Gra:   http{'s' if use_https else ''}://localhost:{port}/")
    print(f"  Admin: http{'s' if use_https else ''}://localhost:{port}/admin   (pierwsze założone konto jest adminem)\n")
    # FLASK_DEBUG=1 włącza automatyczne przeładowanie po zmianie kodu (tylko na własnym komputerze!).
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1",
            ssl_context="adhoc" if use_https else None)
