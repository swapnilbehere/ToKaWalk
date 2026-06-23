import contextlib
import os

import aiosqlite

DB_PATH = os.getenv("DB_PATH", "tokawalk.db")


@contextlib.asynccontextmanager
async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        yield db


async def init_db() -> None:
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    async with aiosqlite.connect(DB_PATH) as db:
        with open(schema_path) as f:
            await db.executescript(f.read())
        await db.commit()
