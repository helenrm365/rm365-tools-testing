import time
from fastapi import FastAPI, Request

def install_middleware(app: FastAPI):
    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        t0 = time.time()
        resp = await call_next(request)
        dt = time.time() - t0
        # Keep logs short and useful
        return resp
