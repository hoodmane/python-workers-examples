import pydantic
import asgi
from fastapi import FastAPI
from workers import WorkerEntrypoint
from pathlib import Path
import fastapi



class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env)

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "ok"}
