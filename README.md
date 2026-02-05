# Telegram WebApp — 3D Volume Calculator

Загружает STL‑модель, считает объём и вес восковки (плотность 0.8 г/см³), показывает скриншот.

## Локальный запуск

```bash
python -m http.server 8010 --directory public
```

Откройте `http://127.0.0.1:8010`.

## Деплой (Railway)

Используется `Dockerfile` на базе `caddy:2-alpine`.
Railway автоматически соберёт и запустит контейнер.

## Формат

- Поддерживается STL (binary/ASCII).
