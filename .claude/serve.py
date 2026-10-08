# -*- coding: utf-8 -*-
"""Статический сервер для предпросмотра игры. Порт берём из окружения:
   его назначает панель предпросмотра, чтобы не драться за занятый."""
import functools, http.server, os, socketserver

PORT = int(os.environ.get("PORT") or 8787)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), handler) as srv:
    print("игра на http://127.0.0.1:%d/" % PORT, flush=True)
    srv.serve_forever()
