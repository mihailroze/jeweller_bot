# Telegram WebApp — 3D Volume Calculator

Загружает STL‑модель, считает объём и вес восковки (плотность 0.8 г/см³), показывает скриншот.

## Локальный запуск

```bash
python -m http.server 8010 --directory public
```

Откройте `http://127.0.0.1:8010`.

## Деплой (Railway)

Проект запускается из `Procfile`:

```
web: python -m http.server $PORT --directory public
```

## Формат

- Поддерживается STL (binary/ASCII).
