# Jeweller Journal API

Minimal FastAPI backend for a jeweller journal with orders and reminders.

## Quick start

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Endpoints (summary)

- GET /health
- Orders
  - POST /orders
  - GET /orders?user_id=...&status=...&overdue=...&q=...
  - GET /orders/{order_id}?user_id=...
  - PATCH /orders/{order_id}
  - DELETE /orders/{order_id}
  - GET /orders/{order_id}/reminders?user_id=...
  - POST /orders/{order_id}/reminders
  - GET /reminders/due?user_id=...&on=YYYY-MM-DD
  - POST /reminders/{reminder_id}/mark-sent?user_id=...
- Journal
  - POST /journal
  - GET /journal?user_id=...&order_id=...&date_from=...&date_to=...&tag=...&q=...
  - GET /journal/{entry_id}?user_id=...
  - PATCH /journal/{entry_id}
  - DELETE /journal/{entry_id}
  - POST /journal/{entry_id}/attachments (multipart form)
  - GET /journal/{entry_id}/attachments?user_id=...
  - GET /attachments/{attachment_id}/file?user_id=...
  - DELETE /attachments/{attachment_id}?user_id=...

## Notes

- user_id is the Telegram user id and must be provided in requests.
- Reminders are stored by date (calendar-based). Use reminder_offsets on create or set explicit reminder_dates.
- Files are stored locally in data/uploads.
