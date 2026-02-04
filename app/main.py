from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from .db import SessionLocal, init_db
from . import models, schemas
from .storage import save_upload, abs_path, delete_file, ensure_storage

app = FastAPI(title="Jeweller Journal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def on_startup():
    init_db()
    ensure_storage()


def serialize_tags(tags: Optional[List[str]]) -> Optional[str]:
    if not tags:
        return None
    cleaned = [t.strip() for t in tags if t and t.strip()]
    if not cleaned:
        return None
    deduped = list(dict.fromkeys(cleaned))
    return ",".join(deduped)


def get_order_or_404(db: Session, user_id: int, order_id: int) -> models.Order:
    order = db.query(models.Order).filter(
        models.Order.id == order_id,
        models.Order.user_id == user_id,
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def get_entry_or_404(db: Session, user_id: int, entry_id: int) -> models.JournalEntry:
    entry = db.query(models.JournalEntry).filter(
        models.JournalEntry.id == entry_id,
        models.JournalEntry.user_id == user_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry


def replace_reminders(
    db: Session,
    order: models.Order,
    reminder_offsets: Optional[List[int]] = None,
    reminder_dates: Optional[List[date]] = None,
) -> List[models.OrderReminder]:
    db.query(models.OrderReminder).filter(
        models.OrderReminder.order_id == order.id,
        models.OrderReminder.user_id == order.user_id,
    ).delete()
    db.flush()

    reminders: List[models.OrderReminder] = []
    if reminder_dates:
        dates = sorted({d for d in reminder_dates})
    elif reminder_offsets:
        offsets = sorted({o for o in reminder_offsets if o is not None and o >= 0})
        dates = sorted({order.deadline - timedelta(days=o) for o in offsets})
    else:
        return reminders

    for d in dates:
        reminder = models.OrderReminder(
            order_id=order.id,
            user_id=order.user_id,
            remind_on=d,
        )
        db.add(reminder)
        reminders.append(reminder)

    return reminders


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


# Orders
@app.post("/orders", response_model=schemas.OrderOut)
def create_order(payload: schemas.OrderCreate, db: Session = Depends(get_db)):
    order = models.Order(
        user_id=payload.user_id,
        client=payload.client,
        order_number=payload.order_number,
        status=payload.status,
        priority=payload.priority,
        deadline=payload.deadline,
        notes=payload.notes,
    )
    db.add(order)
    db.flush()
    replace_reminders(db, order, reminder_offsets=payload.reminder_offsets)
    db.commit()
    db.refresh(order)
    return order


@app.get("/orders", response_model=List[schemas.OrderOut])
def list_orders(
    user_id: int = Query(...),
    status: Optional[str] = Query(None),
    overdue: Optional[bool] = Query(None),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(models.Order).filter(models.Order.user_id == user_id)
    if status:
        query = query.filter(models.Order.status == status)
    if overdue is True:
        query = query.filter(models.Order.deadline < date.today())
    if q:
        like = f"%{q}%"
        query = query.filter(or_(models.Order.client.ilike(like), models.Order.order_number.ilike(like)))
    return query.order_by(models.Order.deadline.asc()).all()


@app.get("/orders/{order_id}", response_model=schemas.OrderOut)
def get_order(order_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    return get_order_or_404(db, user_id, order_id)


@app.patch("/orders/{order_id}", response_model=schemas.OrderOut)
def update_order(
    order_id: int,
    payload: schemas.OrderUpdate,
    user_id: int = Query(...),
    db: Session = Depends(get_db),
):
    order = get_order_or_404(db, user_id, order_id)
    data = payload.model_dump(exclude_unset=True)
    reminder_offsets = data.pop("reminder_offsets", None)
    for key, value in data.items():
        setattr(order, key, value)
    db.add(order)
    db.flush()
    if reminder_offsets is not None:
        replace_reminders(db, order, reminder_offsets=reminder_offsets)
    db.commit()
    db.refresh(order)
    return order


@app.delete("/orders/{order_id}")
def delete_order(order_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    order = get_order_or_404(db, user_id, order_id)
    db.delete(order)
    db.commit()
    return {"status": "deleted"}


@app.get("/orders/{order_id}/reminders", response_model=List[schemas.ReminderOut])
def list_order_reminders(order_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    get_order_or_404(db, user_id, order_id)
    return (
        db.query(models.OrderReminder)
        .filter(models.OrderReminder.order_id == order_id, models.OrderReminder.user_id == user_id)
        .order_by(models.OrderReminder.remind_on.asc())
        .all()
    )


@app.post("/orders/{order_id}/reminders", response_model=List[schemas.ReminderOut])
def set_order_reminders(
    order_id: int,
    payload: schemas.ReminderSet,
    user_id: int = Query(...),
    db: Session = Depends(get_db),
):
    order = get_order_or_404(db, user_id, order_id)
    if not payload.reminder_offsets and not payload.reminder_dates:
        raise HTTPException(status_code=400, detail="No reminder dates or offsets provided")
    reminders = replace_reminders(
        db,
        order,
        reminder_offsets=payload.reminder_offsets,
        reminder_dates=payload.reminder_dates,
    )
    db.commit()
    return reminders


@app.get("/reminders/due", response_model=List[schemas.ReminderOut])
def reminders_due(
    user_id: int = Query(...),
    on: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    target = on or date.today()
    return (
        db.query(models.OrderReminder)
        .filter(
            models.OrderReminder.user_id == user_id,
            models.OrderReminder.remind_on <= target,
            models.OrderReminder.sent_at.is_(None),
        )
        .order_by(models.OrderReminder.remind_on.asc())
        .all()
    )


@app.post("/reminders/{reminder_id}/mark-sent", response_model=schemas.ReminderOut)
def mark_reminder_sent(
    reminder_id: int,
    user_id: int = Query(...),
    db: Session = Depends(get_db),
):
    reminder = db.query(models.OrderReminder).filter(
        models.OrderReminder.id == reminder_id,
        models.OrderReminder.user_id == user_id,
    ).first()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    reminder.sent_at = datetime.utcnow()
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


# Journal
@app.post("/journal", response_model=schemas.JournalOut)
def create_journal_entry(payload: schemas.JournalCreate, db: Session = Depends(get_db)):
    entry = models.JournalEntry(
        user_id=payload.user_id,
        title=payload.title,
        entry_date=payload.entry_date,
        materials=payload.materials,
        tools=payload.tools,
        settings=payload.settings,
        notes=payload.notes,
        tags=serialize_tags(payload.tags),
        order_id=payload.order_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.get("/journal", response_model=List[schemas.JournalOut])
def list_journal_entries(
    user_id: int = Query(...),
    order_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    tag: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(models.JournalEntry).filter(models.JournalEntry.user_id == user_id)
    if order_id is not None:
        query = query.filter(models.JournalEntry.order_id == order_id)
    if date_from is not None:
        query = query.filter(models.JournalEntry.entry_date >= date_from)
    if date_to is not None:
        query = query.filter(models.JournalEntry.entry_date <= date_to)
    if tag:
        query = query.filter(models.JournalEntry.tags.like(f"%{tag}%"))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(models.JournalEntry.title.ilike(like), models.JournalEntry.notes.ilike(like)))
    return query.order_by(models.JournalEntry.entry_date.desc()).all()


@app.get("/journal/{entry_id}", response_model=schemas.JournalOut)
def get_journal_entry(entry_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    return get_entry_or_404(db, user_id, entry_id)


@app.patch("/journal/{entry_id}", response_model=schemas.JournalOut)
def update_journal_entry(
    entry_id: int,
    payload: schemas.JournalUpdate,
    user_id: int = Query(...),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, user_id, entry_id)
    data = payload.model_dump(exclude_unset=True)
    if "tags" in data:
        data["tags"] = serialize_tags(data["tags"])
    for key, value in data.items():
        setattr(entry, key, value)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.delete("/journal/{entry_id}")
def delete_journal_entry(entry_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, user_id, entry_id)
    for attachment in list(entry.attachments):
        delete_file(attachment.stored_path)
    db.delete(entry)
    db.commit()
    return {"status": "deleted"}


@app.post("/journal/{entry_id}/attachments", response_model=schemas.AttachmentOut)
def upload_journal_attachment(
    entry_id: int,
    user_id: int = Form(...),
    kind: str = Form("photo"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    entry = get_entry_or_404(db, user_id, entry_id)
    stored_path, size = save_upload(user_id, file.filename, file.file)
    attachment = models.Attachment(
        journal_entry_id=entry.id,
        user_id=user_id,
        kind=kind,
        filename=file.filename,
        content_type=file.content_type,
        size=size,
        stored_path=stored_path,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@app.get("/journal/{entry_id}/attachments", response_model=List[schemas.AttachmentOut])
def list_journal_attachments(entry_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    get_entry_or_404(db, user_id, entry_id)
    return (
        db.query(models.Attachment)
        .filter(models.Attachment.journal_entry_id == entry_id, models.Attachment.user_id == user_id)
        .order_by(models.Attachment.created_at.desc())
        .all()
    )


@app.get("/attachments/{attachment_id}/file")
def get_attachment_file(attachment_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    attachment = db.query(models.Attachment).filter(
        models.Attachment.id == attachment_id,
        models.Attachment.user_id == user_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = abs_path(attachment.stored_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path)


@app.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: int, user_id: int = Query(...), db: Session = Depends(get_db)):
    attachment = db.query(models.Attachment).filter(
        models.Attachment.id == attachment_id,
        models.Attachment.user_id == user_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    delete_file(attachment.stored_path)
    db.delete(attachment)
    db.commit()
    return {"status": "deleted"}
