import time
from fastapi import FastAPI, Request

def install_middleware(app: FastAPI):
    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        t0 = time.time()
        resp = await call_next(request)
        dt = time.time() - t0

        # Prevent browser from caching JS/CSS so code changes take effect immediately
        path = request.url.path
        if path.endswith(('.js', '.css')):
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            resp.headers["Pragma"] = "no-cache"
            resp.headers["Expires"] = "0"

        # Keep logs short and useful
        return resp
