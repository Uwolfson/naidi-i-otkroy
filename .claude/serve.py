# -*- coding: utf-8 -*-
"""Статический сервер для предпросмотра игры. Порт берём из окружения:
   его назначает панель предпросмотра, чтобы не драться за занятый.

   Сервер многопоточный намеренно: браузер держит соединение открытым
   (keep-alive), и однопоточный TCPServer на этом намертво встаёт —
   следующий запрос не обслуживается, страница просто не загружается."""
import functools, http.server, os

PORT = int(os.environ.get("PORT") or 8787)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
http.server.ThreadingHTTPServer.allow_reuse_address = True
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
srv.daemon_threads = True
print("игра на http://127.0.0.1:%d/" % PORT, flush=True)
srv.serve_forever()
