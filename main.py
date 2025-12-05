from core.backend.db.session import init_db, SessionLocal
from core.backend.db.models import Device

def main():
    init_db()  # создаст таблицу devices, если её ещё нет

    with SessionLocal() as session:
        # пример вставки тестового девайса
        dev = Device(
            name="HROG-5 #1",
            description="Стенд в лаборатории",
            moxa_host="192.168.1.141",
            moxa_port=4002,
        )
        session.add(dev)
        session.commit()

if __name__ == "__main__":
    main()
