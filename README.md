# Telegram WebApp — 3D Volume Calculator

Загружает STL‑модель, считает объём и вес восковки (плотность 0.8 г/см³), показывает скриншот.

## Локальный запуск

```bash
npm install
npm run start
```

Откройте `http://127.0.0.1:3000`.

## Деплой (Railway)

Используется `Dockerfile` на базе `node:20-alpine`.
Railway автоматически соберёт и запустит контейнер.

## Пользователи

При запуске WebApp отправляет `/api/visit` с Telegram user_id.
Список хранится в `data/users.json`.
Для постоянного хранения в Railway подключите Volume к `/app/data`.

## Формат

- Поддерживается STL (binary/ASCII).
