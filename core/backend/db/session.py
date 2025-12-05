# core/backend/db/session.py

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .base import Base

DATABASE_URL = "postgresql+psycopg2://postgres:password@localhost:5432/hrog5"


engine = create_engine(
    DATABASE_URL,
    echo=False,        # можно включить True для логов SQL
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    future=True,
)


def init_db() -> None:
    """
    Создать все таблицы в БД на основе ORM-моделей.
    Для первой инициализации (до Alembic) можно вызвать один раз.
    """
    Base.metadata.create_all(bind=engine)
