# core/backend/db/base.py

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """
    Базовый класс для всех ORM-моделей.
    Все модели БД должны наследоваться от Base.
    """
    pass
